import { useMemo } from "react";

export function useCommandKey() {
  return useMemo(() => {
    const browser = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const platform =
      browser.userAgentData?.platform || browser.platform || browser.userAgent;
    return /mac|iphone|ipad|ipod/i.test(platform);
  }, []);
}
