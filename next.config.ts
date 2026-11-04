import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg", "exceljs", "docxtemplater", "pizzip", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};
export default config;
