// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint32, ebool, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title Redact
 * @notice The first confidential AI credit oracle on Ethereum.
 *
 * Users submit encrypted financial features. A quantized logistic regression
 * classifier runs entirely under FHE and produces an encrypted score plus an
 * encrypted approval verdict. The oracle operator, node operators, and every
 * observer of the chain see nothing but ciphertexts. Only the applicant can
 * decrypt their own result, and only lending protocols the applicant has
 * explicitly authorized can decrypt the approval verdict for underwriting.
 *
 * Feature encoding (8 features, all non-negative uint32):
 *   0: annual income tier      (0-10, higher is better)
 *   1: debt-to-income ratio    (0-100, lower is better)
 *   2: on-time payment count   (0-100)
 *   3: months of credit history (0-600)
 *   4: number of open accounts (0-30)
 *   5: recent inquiries        (0-20, lower is better)
 *   6: employment tenure       (months, 0-600)
 *   7: wallet age              (months onchain, 0-200)
 *
 * FHEVM only supports unsigned encrypted integers, so weights are split into
 * a positive component and a negative component. Both are stored as uint32.
 * The scoring formula is:
 *
 *   score = bias + sum(posWeights[i] * features[i]) - sum(negWeights[i] * features[i])
 *   approved = score >= threshold
 *
 * All arithmetic on features[i] happens on encrypted values via the FHE library.
 */
contract Redact is ZamaEthereumConfig {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint8 public constant NUM_FEATURES = 8;

    /*//////////////////////////////////////////////////////////////
                             MODEL PARAMETERS
    //////////////////////////////////////////////////////////////*/

    uint32[NUM_FEATURES] public posWeights;
    uint32[NUM_FEATURES] public negWeights;
    uint32 public bias;
    uint32 public threshold;
    uint32 public modelVersion;
    address public operator;

    /*//////////////////////////////////////////////////////////////
                              APPLICATIONS
    //////////////////////////////////////////////////////////////*/

    struct Application {
        euint32 encryptedScore;
        ebool encryptedApproved;
        uint256 timestamp;
        uint32 modelVersionAtSubmission;
        bool exists;
    }

    mapping(address => Application) private _applications;
    uint256 public totalApplications;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event ApplicationSubmitted(address indexed user, uint256 timestamp, uint32 modelVersion);
    event LenderAuthorized(address indexed user, address indexed lender);
    event ModelUpdated(uint32 newVersion);
    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOperator() {
        require(msg.sender == operator, "Redact: caller is not the operator");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

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

    /**
     * @notice Submit an encrypted credit application.
     * @param encryptedFeatures Fixed-size array of external encrypted uint32 handles.
     * @param inputProof        ZK proof that the encrypted inputs are well-formed.
     */
    function submitApplication(
        externalEuint32[NUM_FEATURES] calldata encryptedFeatures,
        bytes calldata inputProof
    ) external {
        euint32[NUM_FEATURES] memory features;
        for (uint8 i = 0; i < NUM_FEATURES; i++) {
            features[i] = FHE.fromExternal(encryptedFeatures[i], inputProof);
        }

        euint32 posSum = FHE.asEuint32(bias);
        euint32 negSum = FHE.asEuint32(0);

        for (uint8 i = 0; i < NUM_FEATURES; i++) {
            if (posWeights[i] != 0) {
                posSum = FHE.add(posSum, FHE.mul(features[i], posWeights[i]));
            }
            if (negWeights[i] != 0) {
                negSum = FHE.add(negSum, FHE.mul(features[i], negWeights[i]));
            }
        }

        euint32 negPlusThreshold = FHE.add(negSum, threshold);
        ebool approved = FHE.ge(posSum, negPlusThreshold);

        _applications[msg.sender] = Application({
            encryptedScore: posSum,
            encryptedApproved: approved,
            timestamp: block.timestamp,
            modelVersionAtSubmission: modelVersion,
            exists: true
        });

        FHE.allowThis(posSum);
        FHE.allowThis(approved);
        FHE.allow(posSum, msg.sender);
        FHE.allow(approved, msg.sender);

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

    function getVerdictFor(address user) external view returns (ebool) {
        require(_applications[user].exists, "Redact: no application for user");
        return _applications[user].encryptedApproved;
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
     * @notice Grant a lending protocol permission to decrypt the caller's verdict.
     * @dev    The composability primitive. The user consents to sharing their yes/no
     *         with a specific lender, and never has to reveal the raw features or
     *         the underlying score.
     */
    function authorizeLender(address lender) external {
        require(_applications[msg.sender].exists, "Redact: no application");
        require(lender != address(0), "Redact: zero lender");
        FHE.allow(_applications[msg.sender].encryptedApproved, lender);
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
