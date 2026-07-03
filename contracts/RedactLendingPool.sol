// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, ebool, euint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IRedact {
    function getTierFor(address user) external view returns (euint32);
    function applicationExists(address user) external view returns (bool);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/**
 * @title RedactLendingPool (v2)
 * @notice Undercollateralized lending against confidential AI risk tiers.
 *
 * v2 changes:
 *  - Pays out REAL tokens (rUSDC) from pool liquidity to the borrower's wallet.
 *  - Loan size is priced by the encrypted RISK TIER, not a binary verdict:
 *      tier 0: rejected, no loan
 *      tier 1: 500 rUSDC
 *      tier 2: 1,000 rUSDC
 *      tier 3: 2,500 rUSDC
 *  - Loans carry 5 percent interest and a 30 day term.
 *
 * Privacy model: the pool learns the borrower's coarse tier (with a KMS proof
 * it is genuine) and nothing else. The raw features and the numeric score stay
 * encrypted forever.
 *
 * Flow:
 *  1. Borrower submits an encrypted application to Redact.
 *  2. Borrower calls redact.authorizeLender(pool).
 *  3. Borrower calls requestLoan(). The pool marks the encrypted tier publicly
 *     decryptable and records the pending request.
 *  4. The borrower's client publicly decrypts the tier via the Zama relayer,
 *     obtaining the clear tier and a KMS decryption proof.
 *  5. Anyone calls finalizeLoan(borrower, clearTier, proof). FHE.checkSignatures
 *     reverts on forged values. On a valid tier >= 1, tokens transfer.
 */
contract RedactLendingPool is ZamaEthereumConfig {
    IRedact public immutable oracle;
    IERC20 public immutable token;

    uint256 public constant INTEREST_BPS = 500; // 5 percent
    uint256 public constant TERM = 30 days;

    struct PendingLoan {
        uint256 requestedAt;
        euint32 tierHandle;
        bool exists;
    }

    struct Loan {
        uint256 principal;
        uint256 amountDue;
        uint256 dueAt;
        uint8 tier;
        bool active;
    }

    mapping(address => PendingLoan) public pending;
    mapping(address => Loan) public loans;
    uint256 public totalLoansIssued;
    uint256 public totalLoansRejected;

    event LoanRequested(address indexed borrower, bytes32 tierHandle);
    event LoanIssued(address indexed borrower, uint8 tier, uint256 principal, uint256 amountDue, uint256 dueAt);
    event LoanRejected(address indexed borrower);
    event LoanRepaid(address indexed borrower, uint256 amount);

    constructor(address _oracle, address _token) {
        require(_oracle != address(0), "RedactLending: zero oracle");
        require(_token != address(0), "RedactLending: zero token");
        oracle = IRedact(_oracle);
        token = IERC20(_token);
    }

    /// @notice Loan principal for a given tier, in token units (6 decimals).
    function principalForTier(uint8 tier) public pure returns (uint256) {
        if (tier == 1) return 500 * 10 ** 6;
        if (tier == 2) return 1_000 * 10 ** 6;
        if (tier >= 3) return 2_500 * 10 ** 6;
        return 0;
    }

    /**
     * @notice Step 1: mark the borrower's encrypted tier publicly decryptable
     *         and record the pending request.
     */
    function requestLoan() external {
        require(oracle.applicationExists(msg.sender), "RedactLending: no credit application");
        require(!pending[msg.sender].exists, "RedactLending: request already pending");
        require(!loans[msg.sender].active, "RedactLending: active loan outstanding");

        euint32 tier = oracle.getTierFor(msg.sender);
        FHE.makePubliclyDecryptable(tier);

        pending[msg.sender] = PendingLoan({requestedAt: block.timestamp, tierHandle: tier, exists: true});

        emit LoanRequested(msg.sender, FHE.toBytes32(tier));
    }

    /**
     * @notice Step 2: verify the KMS decryption proof for the tier and settle.
     *         Reverts on forged cleartexts or proofs.
     */
    function finalizeLoan(address borrower, bytes memory abiEncodedClearTier, bytes memory decryptionProof) external {
        PendingLoan memory p = pending[borrower];
        require(p.exists, "RedactLending: no pending request");
        delete pending[borrower];

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(p.tierHandle);

        FHE.checkSignatures(cts, abiEncodedClearTier, decryptionProof);

        uint32 tier32 = abi.decode(abiEncodedClearTier, (uint32));
        uint8 tier = tier32 > 3 ? 3 : uint8(tier32);
        uint256 principal = principalForTier(tier);

        if (principal == 0) {
            totalLoansRejected += 1;
            emit LoanRejected(borrower);
            return;
        }

        uint256 amountDue = principal + (principal * INTEREST_BPS) / 10_000;
        loans[borrower] = Loan({
            principal: principal,
            amountDue: amountDue,
            dueAt: block.timestamp + TERM,
            tier: tier,
            active: true
        });

        totalLoansIssued += 1;
        require(token.transfer(borrower, principal), "RedactLending: payout failed");
        emit LoanIssued(borrower, tier, principal, amountDue, loans[borrower].dueAt);
    }

    /**
     * @notice Repay the outstanding loan in full (principal + interest).
     *         Requires prior token approval to the pool.
     */
    function repay() external {
        Loan memory l = loans[msg.sender];
        require(l.active, "RedactLending: no active loan");
        delete loans[msg.sender];
        require(token.transferFrom(msg.sender, address(this), l.amountDue), "RedactLending: repay transfer failed");
        emit LoanRepaid(msg.sender, l.amountDue);
    }

    /// @notice Cancel your own pending request before finalization.
    function cancelRequest() external {
        require(pending[msg.sender].exists, "RedactLending: no pending request");
        delete pending[msg.sender];
    }

    /// @notice Pool liquidity available for new loans.
    function liquidity() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
