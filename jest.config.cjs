// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tools"],
  // Tests don't load 3D models.
  moduleNameMapper: { "\\.glb$": "<rootDir>/tools/contact-center-3d/tests/glbStub.js" }
};