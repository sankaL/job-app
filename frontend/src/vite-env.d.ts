/// <reference types="vite/client" />

type RuntimeAppConfig = {
  VITE_APP_ENV?: string;
  VITE_APP_DEV_MODE?: string;
  VITE_API_URL?: string;
};

interface Window {
  __APP_CONFIG__?: RuntimeAppConfig;
}
