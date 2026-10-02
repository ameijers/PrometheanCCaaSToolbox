const path = require("path");

// One entry per toolbox tool. Each builds to dist/webresource/<name>/bundle.js — add one line
// here per new tool under tools/<tool-folder>/webresource/index.tsx.
module.exports = {
  mode: "production",
  entry: {
    routingtester: "./tools/visual-routing-tester/webresource/index.tsx",
    contextvariablemonitor: "./tools/context-variable-monitor/webresource/index.tsx",
    agentreadiness: "./tools/agent-readiness-checker/webresource/index.tsx",
    artifactfinder: "./tools/environment-artifact-finder/webresource/index.tsx",
    voicebuilder: "./tools/voice-workstream-builder/webresource/index.tsx",
    recordingprovisioner: "./tools/voice-recording-provisioner/webresource/index.tsx",
    queuebuilder: "./tools/queue-builder/webresource/index.tsx",
    profilebuilder: "./tools/profile-builder/webresource/index.tsx",
    businessunitbuilder: "./tools/business-unit-builder/webresource/index.tsx"
  },
  output: {
    path: path.resolve(__dirname, "dist/webresource"),
    filename: "[name]/bundle.js"
  },
  resolve: { extensions: [".ts", ".tsx", ".js"] },
  module: {
    rules: [{ test: /\.tsx?$/, use: "ts-loader", exclude: /node_modules/ }]
  }
};
