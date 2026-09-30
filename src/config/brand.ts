import configuredBrand from "../../config/karven-brand.json";

const env = import.meta.env;
export const IS_KARVEN_PRODUCT_BUILD = env.VITE_KARVEN_PRODUCT === "1";

export const KARVEN_BRAND = Object.freeze({
  name: env.VITE_KARVEN_BRAND_NAME || configuredBrand.brandName,
  shortName: env.VITE_KARVEN_SHORT_NAME || configuredBrand.shortName,
  company: env.VITE_KARVEN_COMPANY || configuredBrand.companyName,
  urls: Object.freeze({
    marketing: env.VITE_KARVEN_MARKETING_URL || "",
    app: env.VITE_KARVEN_APP_URL || "",
    chat: env.VITE_KARVEN_CHAT_URL || "",
    api: env.VITE_KARVEN_API_URL || "",
    auth: env.VITE_KARVEN_AUTH_URL || "",
    admin: env.VITE_KARVEN_ADMIN_URL || "",
    docs: env.VITE_KARVEN_DOCS_URL || "",
    support: env.VITE_KARVEN_SUPPORT_URL || "",
    status: env.VITE_KARVEN_STATUS_URL || "",
    downloads: env.VITE_KARVEN_DOWNLOADS_URL || "",
  }),
  analytics: Object.freeze({
    enabled: env.VITE_KARVEN_ANALYTICS_ENABLED === "1",
    apiKey: env.VITE_KARVEN_ANALYTICS_API_KEY || "",
    apiHost: env.VITE_KARVEN_ANALYTICS_API_HOST || "",
    uiHost: env.VITE_KARVEN_ANALYTICS_UI_HOST || "",
  }),
});
