import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", ".next-*/**", "node_modules/**", "src/api/schema.d.ts", "e2e-results/**", "playwright-report/**"] },
];

export default config;
