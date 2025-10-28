import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

/**
 * 우리는 3개의 번들을 만든다:
 *
 * 1) dist/index.js
 *    - format: esm
 *    - SDK용 (React/Vite 등에서 import 해서 쓰는 용도)
 *
 * 2) dist/collector.iife.js
 *    - format: iife
 *    - 실제 수집 로직 (window.apilog 구현, 클릭/스크롤 추적 등)
 *
 * 3) dist/embed.js
 *    - format: iife
 *    - 외부 사이트가 넣는 최초 <script> 로더
 *    - embed.js가 collector.iife.js를 동적으로 불러오고 init 호출
 */

export default [
  // 1) ESM SDK
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.js",
      format: "esm",
      sourcemap: false,
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: "./tsconfig.json" }),
      terser(), // <- default import 사용
    ],
    treeshake: true,
  },

  // 2) collector.iife.js (실제 트래커)
  {
    input: "src/bootstrap.ts",
    output: {
      file: "dist/collector.iife.js",
      format: "iife",
      name: "ApiLogCollector", // 전역으로 디버깅할 때만 쓰는 이름
      sourcemap: false,
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: "./tsconfig.json" }),
      terser(),
    ],
    treeshake: true,
  },

  // 3) embed.js (로더 스크립트)
  {
    input: "src/embed.ts",
    output: {
      file: "dist/embed.js",
      format: "iife",
      name: "ApiLogEmbed",
      sourcemap: false,
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: "./tsconfig.json" }),
      terser(),
    ],
    treeshake: true,
  },
];
