// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// A .glb model is inlined by webpack as a data: URL.
declare module "*.glb" {
  const url: string;
  export default url;
}
