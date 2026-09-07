export const parseUserAgent = (uaString = "") => {
    if (!uaString) {
        return {
            device: "Unknown Device",
            browser: "Unknown Browser",
            os: "Unknown OS",
            deviceType: "desktop",
        };
    }

    let os = "Unknown OS";
    if (/windows nt 10/i.test(uaString)) os = "Windows 10/11";
    else if (/windows nt/i.test(uaString)) os = "Windows";
    else if (/mac os x/i.test(uaString)) os = "macOS";
    else if (/android/i.test(uaString)) os = "Android";
    else if (/iphone|ipad|ipod/i.test(uaString)) os = "iOS";
    else if (/linux/i.test(uaString)) os = "Linux";

    let browser = "Browser";
    if (/edg/i.test(uaString)) browser = "Microsoft Edge";
    else if (/chrome|crios/i.test(uaString) && !/opr|opera|edg/i.test(uaString)) browser = "Chrome";
    else if (/firefox|fxios/i.test(uaString)) browser = "Firefox";
    else if (/safari/i.test(uaString) && !/chrome|crios/i.test(uaString)) browser = "Safari";
    else if (/opr|opera/i.test(uaString)) browser = "Opera";

    let deviceType = "desktop";
    if (/mobile/i.test(uaString) || /iphone|ipod/i.test(uaString) || (/android/i.test(uaString) && !/tablet/i.test(uaString))) {
        deviceType = "mobile";
    } else if (/ipad/i.test(uaString) || /tablet/i.test(uaString)) {
        deviceType = "tablet";
    }

    const device = `${browser} on ${os}`;

    return { device, browser, os, deviceType };
};

export const getClientIp = (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
        return forwarded.split(",")[0].trim();
    }
    return req.socket?.remoteAddress || req.ip || "127.0.0.1";
};
