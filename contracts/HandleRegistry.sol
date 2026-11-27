// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HandleRegistry
/// @notice Public, onchain "memorable tag" for a wallet: a unique handle plus a display name.
///         A client types the handle, sees the name, and confirms it is the person they expect
///         before paying. Names are self-declared; handles cannot be changed once claimed, so
///         a handle someone has given out can't later be pointed at a different wallet.
contract HandleRegistry {
    struct Profile {
        string handle;
        string name;
        uint40 since;
    }

    mapping(bytes32 => address) private _owners; // keccak256(handle) => wallet
    mapping(address => Profile) public profiles;

    event Registered(string handle, address indexed owner, string name);
    event NameChanged(address indexed owner, string name);

    error BadHandle();
    error HandleTaken();
    error AlreadyRegistered();
    error NotRegistered();
    error BadName();

    function register(string calldata handle, string calldata name) external {
        if (bytes(profiles[msg.sender].handle).length != 0) revert AlreadyRegistered();
        _checkHandle(handle);
        _checkName(name);
        bytes32 key = keccak256(bytes(handle));
        if (_owners[key] != address(0)) revert HandleTaken();
        _owners[key] = msg.sender;
        profiles[msg.sender] = Profile(handle, name, uint40(block.timestamp));
        emit Registered(handle, msg.sender, name);
    }

    function setName(string calldata name) external {
        if (bytes(profiles[msg.sender].handle).length == 0) revert NotRegistered();
        _checkName(name);
        profiles[msg.sender].name = name;
        emit NameChanged(msg.sender, name);
    }

    function resolve(string calldata handle) external view returns (address owner, string memory name, uint40 since) {
        owner = _owners[keccak256(bytes(handle))];
        Profile storage p = profiles[owner];
        return (owner, p.name, p.since);
    }

    /// 3 to 24 characters, lowercase letters, digits, underscore.
    function _checkHandle(string calldata h) internal pure {
        bytes calldata b = bytes(h);
        if (b.length < 3 || b.length > 24) revert BadHandle();
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) revert BadHandle();
        }
    }

    function _checkName(string calldata n) internal pure {
        uint256 len = bytes(n).length;
        if (len == 0 || len > 60) revert BadName();
    }
}
