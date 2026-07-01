// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IRedact {
    function getVerdictFor(address user) external view returns (ebool);
    function applicationExists(address user) external view returns (bool);
}

/**
 * @title RedactLendingPool
 * @notice A demo undercollateralized lending pool that consumes verdicts from
 *         the Redact confidential credit oracle, using the FHEVM v0.11
 *         self-relaying decryption model.
 *
 *         Flow:
 *           1. Borrower has already submitted an encrypted application to Redact.
 *           2. Borrower calls redact.authorizeLender(address(this)) to consent.
 *           3. Borrower calls requestLoan(amount). The pool marks the encrypted
 *              verdict as publicly decryptable and records the pending request.
 *           4. Offchain, the borrower's client calls publicDecrypt via the Zama
 *              relayer SDK, receiving the clear verdict and a KMS decryption proof.
 *           5. Anyone submits finalizeLoan(borrower, clearVerdict, proof).
 *              The contract rebuilds the ciphertext handle list and calls
 *              FHE.checkSignatures, which reverts unless the cleartext is the
 *              cryptographically genuine decryption of the stored verdict.
 *           6. If approved, the loan is credited. The raw features and the
 *              numeric score never left encryption at any point. The only value
 *              ever revealed is the final yes/no, and only because the borrower
 *              chose to take a loan.
 */
contract RedactLendingPool is ZamaEthereumConfig {
    IRedact public immutable oracle;
    uint256 public immutable maxLoanPerUser;

    struct PendingLoan {
        uint256 amount;
        uint256 requestedAt;
        ebool verdictHandle;
        bool exists;
    }

    // One pending request per borrower at a time.
    mapping(address => PendingLoan) public pending;
    // Total outstanding loan principal per borrower (public in this demo pool).
    mapping(address => uint256) public loanBalance;
    uint256 public totalLoansIssued;
    uint256 public totalLoansRejected;

    event LoanRequested(address indexed borrower, uint256 amount, bytes32 verdictHandle);
    event LoanApproved(address indexed borrower, uint256 amount);
    event LoanRejected(address indexed borrower, uint256 amount);
    event LoanRepaid(address indexed borrower, uint256 amount);

    constructor(address _oracle, uint256 _maxLoanPerUser) {
        require(_oracle != address(0), "RedactLending: zero oracle");
        require(_maxLoanPerUser > 0, "RedactLending: zero max loan");
        oracle = IRedact(_oracle);
        maxLoanPerUser = _maxLoanPerUser;
    }

    /**
     * @notice Step 1 of the loan flow. Marks the borrower's encrypted verdict as
     *         publicly decryptable and records the pending request.
     * @dev    Requires the borrower to have called authorizeLender(this pool) on
     *         Redact first, otherwise this contract has no ACL permission on the
     *         verdict handle and the FHE ops revert.
     * @param  amount The loan amount requested (bounded by maxLoanPerUser).
     */
    function requestLoan(uint256 amount) external {
        require(amount > 0 && amount <= maxLoanPerUser, "RedactLending: bad amount");
        require(oracle.applicationExists(msg.sender), "RedactLending: no credit application");
        require(!pending[msg.sender].exists, "RedactLending: request already pending");
        require(loanBalance[msg.sender] + amount <= maxLoanPerUser, "RedactLending: cap exceeded");

        ebool verdict = oracle.getVerdictFor(msg.sender);
        FHE.makePubliclyDecryptable(verdict);

        pending[msg.sender] = PendingLoan({
            amount: amount,
            requestedAt: block.timestamp,
            verdictHandle: verdict,
            exists: true
        });

        emit LoanRequested(msg.sender, amount, FHE.toBytes32(verdict));
    }

    /**
     * @notice Step 2 of the loan flow. Verifies the KMS decryption proof for the
     *         borrower's verdict and settles the loan request accordingly.
     * @dev    Reverts with KMSInvalidSigner if the cleartext or proof is forged,
     *         or if the proof belongs to a different ciphertext.
     * @param  borrower                    The borrower whose request is being settled.
     * @param  abiEncodedClearVerdict      ABI-encoded bool from the relayer's publicDecrypt.
     * @param  decryptionProof             KMS decryption proof from the relayer's publicDecrypt.
     */
    function finalizeLoan(
        address borrower,
        bytes memory abiEncodedClearVerdict,
        bytes memory decryptionProof
    ) external {
        PendingLoan memory p = pending[borrower];
        require(p.exists, "RedactLending: no pending request");
        delete pending[borrower];

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(p.verdictHandle);

        // Reverts unless abiEncodedClearVerdict is the genuine decryption of the handle.
        FHE.checkSignatures(cts, abiEncodedClearVerdict, decryptionProof);

        bool approved = abi.decode(abiEncodedClearVerdict, (bool));

        if (approved) {
            loanBalance[borrower] += p.amount;
            totalLoansIssued += 1;
            emit LoanApproved(borrower, p.amount);
        } else {
            totalLoansRejected += 1;
            emit LoanRejected(borrower, p.amount);
        }
    }

    /**
     * @notice Cancel your own pending request (e.g. if you changed your mind
     *         before finalization).
     */
    function cancelRequest() external {
        require(pending[msg.sender].exists, "RedactLending: no pending request");
        delete pending[msg.sender];
    }

    /**
     * @notice Simple repay function to close out a loan in the demo.
     */
    function repay(uint256 amount) external {
        require(amount > 0 && amount <= loanBalance[msg.sender], "RedactLending: bad repay");
        loanBalance[msg.sender] -= amount;
        emit LoanRepaid(msg.sender, amount);
    }
}
