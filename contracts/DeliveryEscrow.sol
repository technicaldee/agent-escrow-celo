// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title DeliveryEscrow
/// @notice Holds a client's USD₮ until the freelancer's work is approved.
///         An off-chain agent (the `agent` address) reviews delivery evidence, rules on
///         disputes and, for freelancers who want naira, converts the payout to cNGN
///         through Textile FX. Every path is bounded on-chain: the agent can never take
///         funds for itself, and every stuck state has a timeout that returns control
///         to the humans.
contract DeliveryEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded, // client paid, waiting for delivery
        Delivered, // freelancer posted evidence, client review window running
        Disputed, // client disputed, waiting for the agent's ruling
        Releasing, // payout owed to freelancer in naira, waiting for the agent to pick it up
        Settling, // agent holds the USD₮ and is converting it to cNGN
        Settled, // naira delivered
        Released, // paid out in USD₮
        Refunded // returned to client
    }

    struct Job {
        address client;
        address freelancer;
        uint128 amount; // USD₮ base units (6 decimals)
        uint40 deliverBy;
        uint40 reviewWindow;
        uint40 deliveredAt;
        uint40 disputedAt;
        uint40 releasingAt;
        Status status;
        bool payNaira;
        bytes32 briefHash; // hash of the agreed brief, so scope is fixed at funding time
        uint128 pendingNet; // freelancer's net payout still in the contract (Releasing)
    }

    uint16 public constant MAX_FEE_BPS = 300; // 3% hard cap, versus 10-20% on marketplaces
    uint40 public constant MIN_REVIEW = 1 hours;
    uint40 public constant MAX_REVIEW = 14 days;
    uint40 public constant RULING_TIMEOUT = 7 days; // agent silent => either side can force a 50/50 split
    uint40 public constant SETTLE_GRACE = 1 hours; // agent silent => freelancer can take USD₮ instead of naira
    uint40 public constant REFUND_GRACE = 3 days; // after deliverBy, client may refund if nothing was delivered

    IERC20 public immutable token;
    address public agent;
    address public treasury;
    uint16 public feeBps;
    uint256 public nextJobId = 1;
    mapping(uint256 => Job) public jobs;

    event JobFunded(
        uint256 indexed id,
        address indexed client,
        address indexed freelancer,
        uint256 amount,
        uint40 deliverBy,
        uint40 reviewWindow,
        bool payNaira,
        bytes32 briefHash
    );
    event Delivered(uint256 indexed id, string evidenceURI);
    event Disputed(uint256 indexed id, string reasonURI);
    event Ruled(uint256 indexed id, uint16 freelancerBps, string rationaleURI);
    event Approved(uint256 indexed id, address by);
    event SettlementRequested(uint256 indexed id, address indexed freelancer, uint256 usdtAmount);
    event SettlementStarted(uint256 indexed id, uint256 usdtAmount);
    event SettlementConfirmed(uint256 indexed id, bytes32 swapTx, uint256 cngnOut);
    event PaidUsdt(uint256 indexed id, address indexed to, uint256 amount, uint256 fee);
    event Refunded(uint256 indexed id, uint256 amount);
    event AgentChanged(address agent);
    event TreasuryChanged(address treasury);
    event FeeChanged(uint16 feeBps);

    error NotClient();
    error NotFreelancer();
    error NotAgent();
    error BadStatus(Status current);
    error BadParams();
    error TooEarly();
    error TooLate();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address token_, address agent_, address treasury_, uint16 feeBps_, address owner_) Ownable(owner_) {
        if (token_ == address(0) || agent_ == address(0) || treasury_ == address(0) || feeBps_ > MAX_FEE_BPS) {
            revert BadParams();
        }
        token = IERC20(token_);
        agent = agent_;
        treasury = treasury_;
        feeBps = feeBps_;
    }

    // ---------------------------------------------------------------- client

    /// @notice Client funds a job. Caller must have approved `amount` of the token first.
    function fund(
        address freelancer,
        uint128 amount,
        uint40 deliverBy,
        uint40 reviewWindow,
        bool payNaira,
        bytes32 briefHash
    ) external nonReentrant returns (uint256 id) {
        if (
            freelancer == address(0) || freelancer == msg.sender || amount == 0 || deliverBy <= block.timestamp
                || reviewWindow < MIN_REVIEW || reviewWindow > MAX_REVIEW
        ) revert BadParams();

        id = nextJobId++;
        jobs[id] = Job({
            client: msg.sender,
            freelancer: freelancer,
            amount: amount,
            deliverBy: deliverBy,
            reviewWindow: reviewWindow,
            deliveredAt: 0,
            disputedAt: 0,
            releasingAt: 0,
            status: Status.Funded,
            payNaira: payNaira,
            briefHash: briefHash,
            pendingNet: 0
        });
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit JobFunded(id, msg.sender, freelancer, amount, deliverBy, reviewWindow, payNaira, briefHash);
    }

    /// @notice Client approves the work and releases payment.
    function approve(uint256 id) external nonReentrant {
        Job storage j = jobs[id];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Funded && j.status != Status.Delivered) revert BadStatus(j.status);
        emit Approved(id, msg.sender);
        _payFreelancer(id, j, j.amount);
    }

    /// @notice Client disputes delivered work inside the review window.
    function dispute(uint256 id, string calldata reasonURI) external {
        Job storage j = jobs[id];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Delivered) revert BadStatus(j.status);
        if (block.timestamp >= j.deliveredAt + j.reviewWindow) revert TooLate();
        j.status = Status.Disputed;
        j.disputedAt = uint40(block.timestamp);
        emit Disputed(id, reasonURI);
    }

    /// @notice Client takes the money back if nothing was delivered well after the deadline.
    function refund(uint256 id) external nonReentrant {
        Job storage j = jobs[id];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Funded) revert BadStatus(j.status);
        if (block.timestamp <= j.deliverBy + REFUND_GRACE) revert TooEarly();
        j.status = Status.Refunded;
        token.safeTransfer(j.client, j.amount);
        emit Refunded(id, j.amount);
    }

    // ------------------------------------------------------------ freelancer

    /// @notice Freelancer posts evidence of delivery (staging URL, repo diff, screenshots).
    function markDelivered(uint256 id, string calldata evidenceURI) external {
        Job storage j = jobs[id];
        if (msg.sender != j.freelancer) revert NotFreelancer();
        if (j.status != Status.Funded) revert BadStatus(j.status);
        j.status = Status.Delivered;
        j.deliveredAt = uint40(block.timestamp);
        emit Delivered(id, evidenceURI);
    }

    /// @notice Freelancer prefers USD₮ if the agent did not pick up a naira payout in time.
    function claimUsdt(uint256 id) external nonReentrant {
        Job storage j = jobs[id];
        if (msg.sender != j.freelancer) revert NotFreelancer();
        if (j.status != Status.Releasing) revert BadStatus(j.status);
        if (block.timestamp < j.releasingAt + SETTLE_GRACE) revert TooEarly();
        uint128 net = j.pendingNet;
        j.pendingNet = 0;
        j.status = Status.Released;
        token.safeTransfer(j.freelancer, net);
        emit PaidUsdt(id, j.freelancer, net, 0);
    }

    // --------------------------------------------------------------- anyone

    /// @notice If the client stays silent past the review window, anyone can release payment.
    function autoRelease(uint256 id) external nonReentrant {
        Job storage j = jobs[id];
        if (j.status != Status.Delivered) revert BadStatus(j.status);
        if (block.timestamp < j.deliveredAt + j.reviewWindow) revert TooEarly();
        _payFreelancer(id, j, j.amount);
    }

    /// @notice If the agent never rules, either side can force an even split after RULING_TIMEOUT.
    function splitIfUnruled(uint256 id) external nonReentrant {
        Job storage j = jobs[id];
        if (msg.sender != j.client && msg.sender != j.freelancer) revert BadParams();
        if (j.status != Status.Disputed) revert BadStatus(j.status);
        if (block.timestamp < j.disputedAt + RULING_TIMEOUT) revert TooEarly();
        _rule(id, j, 5_000);
    }

    // ----------------------------------------------------------------- agent

    /// @notice The agent's ruling on a dispute: what share (basis points) goes to the freelancer.
    function resolve(uint256 id, uint16 freelancerBps, string calldata rationaleURI) external nonReentrant onlyAgent {
        Job storage j = jobs[id];
        if (j.status != Status.Disputed) revert BadStatus(j.status);
        if (freelancerBps > 10_000) revert BadParams();
        emit Ruled(id, freelancerBps, rationaleURI);
        _rule(id, j, freelancerBps);
    }

    /// @notice Agent takes the freelancer's USD₮ to convert it to cNGN on Textile FX.
    function beginSettlement(uint256 id) external nonReentrant onlyAgent {
        Job storage j = jobs[id];
        if (j.status != Status.Releasing) revert BadStatus(j.status);
        uint128 net = j.pendingNet;
        j.pendingNet = 0;
        j.status = Status.Settling;
        token.safeTransfer(agent, net);
        emit SettlementStarted(id, net);
    }

    /// @notice Agent records that the cNGN reached the freelancer.
    function confirmSettled(uint256 id, bytes32 swapTx, uint256 cngnOut) external onlyAgent {
        Job storage j = jobs[id];
        if (j.status != Status.Settling) revert BadStatus(j.status);
        j.status = Status.Settled;
        emit SettlementConfirmed(id, swapTx, cngnOut);
    }

    // ----------------------------------------------------------------- owner

    function setAgent(address agent_) external onlyOwner {
        if (agent_ == address(0)) revert BadParams();
        agent = agent_;
        emit AgentChanged(agent_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert BadParams();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function setFeeBps(uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert BadParams();
        feeBps = feeBps_;
        emit FeeChanged(feeBps_);
    }

    // -------------------------------------------------------------- internals

    function _rule(uint256 id, Job storage j, uint16 freelancerBps) internal {
        uint128 freelancerShare = uint128((uint256(j.amount) * freelancerBps) / 10_000);
        uint128 clientShare = j.amount - freelancerShare;
        if (clientShare > 0) {
            token.safeTransfer(j.client, clientShare);
            emit Refunded(id, clientShare);
        }
        if (freelancerShare > 0) {
            _payFreelancer(id, j, freelancerShare);
        } else {
            j.status = Status.Refunded;
        }
    }

    function _payFreelancer(uint256 id, Job storage j, uint128 share) internal {
        uint128 fee = uint128((uint256(share) * feeBps) / 10_000);
        uint128 net = share - fee;
        if (fee > 0) token.safeTransfer(treasury, fee);

        if (j.payNaira) {
            j.pendingNet = net;
            j.status = Status.Releasing;
            j.releasingAt = uint40(block.timestamp);
            emit SettlementRequested(id, j.freelancer, net);
        } else {
            j.status = Status.Released;
            token.safeTransfer(j.freelancer, net);
            emit PaidUsdt(id, j.freelancer, net, fee);
        }
    }
}
