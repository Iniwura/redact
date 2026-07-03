// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, euint32, ebool, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title Redact (v2)
 * @notice The first confidential AI credit oracle on Ethereum.
 *
 * v2 adds encrypted RISK TIERS on top of the binary verdict:
 *   tier 0: rejected
 *   tier 1: approved, low margin      (bronze)
 *   tier 2: approved, solid margin    (silver)
 *   tier 3: approved, strong margin   (gold)
 *
 * The tier is computed under FHE from the score margin and stored encrypted.
 * A lender the user authorizes can consume the TIER without ever learning the
 * underlying score, and certainly never the raw features. Privacy is graded:
 * the world sees ciphertexts, an authorized lender sees a coarse tier, only
 * the applicant can see the score, and nobody ever sees the inputs.
 *
 * Scoring (all under FHE, unsigned split-weight form):
 *   posSum = bias + sum(posW[i] * f[i])
 *   negSum = threshold + sum(negW[i] * f[i])
 *   approved = posSum >= negSum
 *   margin thresholds: tier2 at negSum + MARGIN_SILVER, tier3 at negSum + MARGIN_GOLD
 */
contract Redact is ZamaEthereumConfig {
    uint8 public constant NUM_FEATURES = 8;

    /// @notice Margin (in score fixed-point units) over the approval line for silver.
    uint32 public constant MARGIN_SILVER = 2000;
    /// @notice Margin over the approval line for gold.
    uint32 public constant MARGIN_GOLD = 5000;

    uint32[NUM_FEATURES] public posWeights;
    uint32[NUM_FEATURES] public negWeights;
    uint32 public bias;
    uint32 public threshold;
    uint32 public modelVersion;
    address public operator;

    struct Application {
        euint32 encryptedScore;
        ebool encryptedApproved;
        euint32 encryptedTier;
        uint256 timestamp;
        uint32 modelVersionAtSubmission;
        bool exists;
    }

    mapping(address => Application) private _applications;
    uint256 public totalApplications;

    event ApplicationSubmitted(address indexed user, uint256 timestamp, uint32 modelVersion);
    event LenderAuthorized(address indexed user, address indexed lender);
    event ModelUpdated(uint32 newVersion);
    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);

    modifier onlyOperator() {
        require(msg.sender == operator, "Redact: caller is not the operator");
        _;
    }

    constructor(
        uint32[NUM_FEATURES] memory _posWeights,
        uint32[NUM_FEATURES] memory _negWeights,
        uint32 _bias,
        uint32 _threshold
    ) {
        posWeights = _posWeights;
        negWeights = _negWeights;
        bias = _bias;
        threshold = _threshold;
        modelVersion = 1;
        operator = msg.sender;
    }

    /*//////////////////////////////////////////////////////////////
                          CORE APPLICATION FLOW
    //////////////////////////////////////////////////////////////*/

    function submitApplication(
        externalEuint32[NUM_FEATURES] calldata encryptedFeatures,
        bytes calldata inputProof
    ) external {
        euint32[NUM_FEATURES] memory features;
        for (uint8 i = 0; i < NUM_FEATURES; i++) {
            features[i] = FHE.fromExternal(encryptedFeatures[i], inputProof);
        }

        euint32 posSum = FHE.asEuint32(bias);
        euint32 negSum = FHE.asEuint32(threshold);

        for (uint8 i = 0; i < NUM_FEATURES; i++) {
            if (posWeights[i] != 0) {
                posSum = FHE.add(posSum, FHE.mul(features[i], posWeights[i]));
            }
            if (negWeights[i] != 0) {
                negSum = FHE.add(negSum, FHE.mul(features[i], negWeights[i]));
            }
        }

        ebool approved = FHE.ge(posSum, negSum);
        ebool silver = FHE.ge(posSum, FHE.add(negSum, MARGIN_SILVER));
        ebool gold = FHE.ge(posSum, FHE.add(negSum, MARGIN_GOLD));

        // tier = gold ? 3 : silver ? 2 : approved ? 1 : 0
        euint32 tier = FHE.select(
            gold,
            FHE.asEuint32(3),
            FHE.select(silver, FHE.asEuint32(2), FHE.select(approved, FHE.asEuint32(1), FHE.asEuint32(0)))
        );

        _applications[msg.sender] = Application({
            encryptedScore: posSum,
            encryptedApproved: approved,
            encryptedTier: tier,
            timestamp: block.timestamp,
            modelVersionAtSubmission: modelVersion,
            exists: true
        });

        FHE.allowThis(posSum);
        FHE.allowThis(approved);
        FHE.allowThis(tier);
        FHE.allow(posSum, msg.sender);
        FHE.allow(approved, msg.sender);
        FHE.allow(tier, msg.sender);

        totalApplications += 1;
        emit ApplicationSubmitted(msg.sender, block.timestamp, modelVersion);
    }

    /*//////////////////////////////////////////////////////////////
                              READ HANDLES
    //////////////////////////////////////////////////////////////*/

    function getMyScore() external view returns (euint32) {
        require(_applications[msg.sender].exists, "Redact: no application");
        return _applications[msg.sender].encryptedScore;
    }

    function getMyVerdict() external view returns (ebool) {
        require(_applications[msg.sender].exists, "Redact: no application");
        return _applications[msg.sender].encryptedApproved;
    }

    function getMyTier() external view returns (euint32) {
        require(_applications[msg.sender].exists, "Redact: no application");
        return _applications[msg.sender].encryptedTier;
    }

    function getVerdictFor(address user) external view returns (ebool) {
        require(_applications[user].exists, "Redact: no application for user");
        return _applications[user].encryptedApproved;
    }

    function getTierFor(address user) external view returns (euint32) {
        require(_applications[user].exists, "Redact: no application for user");
        return _applications[user].encryptedTier;
    }

    function applicationTimestamp(address user) external view returns (uint256) {
        return _applications[user].timestamp;
    }

    function applicationExists(address user) external view returns (bool) {
        return _applications[user].exists;
    }

    /*//////////////////////////////////////////////////////////////
                             COMPOSABILITY
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Grant a lending protocol permission over the caller's verdict AND
     *         tier. Never the score, never the features.
     */
    function authorizeLender(address lender) external {
        require(_applications[msg.sender].exists, "Redact: no application");
        require(lender != address(0), "Redact: zero lender");
        FHE.allow(_applications[msg.sender].encryptedApproved, lender);
        FHE.allow(_applications[msg.sender].encryptedTier, lender);
        emit LenderAuthorized(msg.sender, lender);
    }

    /*//////////////////////////////////////////////////////////////
                              OPERATOR OPS
    //////////////////////////////////////////////////////////////*/

    function updateModel(
        uint32[NUM_FEATURES] memory _posWeights,
        uint32[NUM_FEATURES] memory _negWeights,
        uint32 _bias,
        uint32 _threshold
    ) external onlyOperator {
        posWeights = _posWeights;
        negWeights = _negWeights;
        bias = _bias;
        threshold = _threshold;
        modelVersion += 1;
        emit ModelUpdated(modelVersion);
    }

    function transferOperator(address newOperator) external onlyOperator {
        require(newOperator != address(0), "Redact: zero operator");
        address previous = operator;
        operator = newOperator;
        emit OperatorTransferred(previous, newOperator);
    }
}
