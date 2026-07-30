const DOCS_URL = "supaschema.mintlify.dev";
const CUSTOM_URL = "supaschema.com";
const WWW_CUSTOM_URL = `www.${CUSTOM_URL}`;

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.hostname === WWW_CUSTOM_URL) {
      incomingUrl.hostname = CUSTOM_URL;
      return Response.redirect(incomingUrl.toString(), 308);
    }

    const upstreamUrl = new URL(request.url);
    upstreamUrl.hostname = DOCS_URL;

    const proxyRequest = new Request(upstreamUrl, request);
    proxyRequest.headers.set("Host", DOCS_URL);
    proxyRequest.headers.set("X-Forwarded-Host", CUSTOM_URL);
    proxyRequest.headers.set("X-Forwarded-Proto", "https");

    const clientIp = request.headers.get("CF-Connecting-IP");
    if (clientIp) {
      proxyRequest.headers.set("CF-Connecting-IP", clientIp);
    }

    try {
      const response = await fetch(proxyRequest);
      return rewriteRedirect(response);
    } catch (error) {
      console.error("supaschema-docs worker origin fetch failed", error);
      return new Response("Bad Gateway", {
        status: 502,
        statusText: "Bad Gateway",
      });
    }
  },
};

function rewriteRedirect(response) {
  const location = response.headers.get("Location");
  if (!location) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Location", location.replace(`https://${DOCS_URL}`, `https://${CUSTOM_URL}`));

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
