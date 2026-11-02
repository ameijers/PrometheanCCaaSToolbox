// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";

const container = document.getElementById("root");
if (container) createRoot(container).render(React.createElement(App));
