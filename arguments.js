// Constructor arguments for Redact at 0x3d00D0779A76b32B6916A895570B4DE5e4ECF5f4
// Used by: npx hardhat verify --constructor-args arguments.js --network sepolia <address>
module.exports = [
  [500, 0, 40, 5, 0, 0, 8, 15], // posWeights
  [0, 30, 0, 0, 20, 100, 0, 0], // negWeights
  2000, // bias
  4000, // threshold
];
