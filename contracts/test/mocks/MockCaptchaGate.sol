// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockCaptchaGate — Always grants a valid session (for tests only)
contract MockCaptchaGate {
    function hasValidSession(address) external pure returns (bool) {
        return true;
    }
}
