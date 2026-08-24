# Research cites — Next.js 16 headers, CSP, Open Graph size, JSON-LD XSS (2026-08-16)

Fetched from primary sources before implementation. No memory-only justifications. Quotes are from the pages as retrieved on 2026-08-16.

**Location:** `acct-web` has no `docs/` research archive (only the App Router `/docs` page). Both CLI and web notes are stored under `acct/docs/research/` per this repo’s research archive convention.

Next.js pages retrieved as **docs version 16.3.1**.

| Fact | Source |
|------|--------|
| Set CSP / `X-Content-Type-Options` / `Referrer-Policy` / `X-Frame-Options` via `headers()` in `next.config` | https://nextjs.org/docs/app/api-reference/config/next-config-js/headers |
| Next.js: `X-Frame-Options` superseded by CSP `frame-ancestors` | same page |
| Next.js also documents CSP in `headers()` for apps that skip nonces | https://nextjs.org/docs/app/guides/content-security-policy |
| MDN: omit `'unsafe-eval'` / avoid `'unsafe-inline'`; hash CSP fits static pages | https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy ; https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP |
| ogp.me requires `og:image` but does **not** specify 1200×630 | https://ogp.me/ |
| Facebook: “at least 1200 x 630” for best display; min 200×200; 8 MB; 1.91:1 | https://developers.facebook.com/docs/sharing/webmasters/images |
| Next.js `ImageResponse` default size is **1200×630**; `opengraph-image` examples use the same | https://nextjs.org/docs/app/api-reference/functions/image-response ; https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image |
| JSON-LD in `<script type="application/ld+json">`; escape script-close / `<` | W3C JSON-LD 1.1 §7.2; HTML spec restrictions; OWASP XSS cheat sheet. Google Search Central documents the script tag, **not** a `\u003c` recipe |

---

## 5. Next.js 16 `headers()` in `next.config` — CSP and related headers

Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/headers  
(title `headers`, docs version **16.3.1**, lastUpdated 2026-06-30)

> Headers allow you to set custom HTTP headers on the response to an incoming request on a given path.

> To set custom HTTP headers you can use the `headers` key in `next.config.js`:

```js
module.exports = {
  headers() {
    return [
      {
        source: '/about',
        headers: [
          { key: 'x-custom-header', value: 'my custom header value' },
        ],
      },
    ]
  },
}
```

> `headers` can be defined as a synchronous or async function. It should return, or resolve to, an array of objects with `source` and `headers` properties.

> Headers are checked before the filesystem which includes pages and `/public` files.

That is the official Next.js 16 config mechanism for **static response headers** (including a marketing site).

### 5.1 Headers Next.js documents by name

Same page, “Options”:

**`X-Content-Type-Options`**

> This header prevents the browser from attempting to guess the type of content if the `Content-Type` header is not explicitly set. […] The only valid value for this header is `nosniff`.

```js
{ key: 'X-Content-Type-Options', value: 'nosniff' }
```

**`Referrer-Policy`**

> This header controls how much information the browser includes when navigating from the current website (origin) to another.

```js
{ key: 'Referrer-Policy', value: 'origin-when-cross-origin' }
```

(`origin-when-cross-origin` is the **example value on this Next.js page**, not a claim that it is the only correct policy.)

**`X-Frame-Options` vs CSP `frame-ancestors`**

> This header indicates whether the site should be allowed to be displayed within an `iframe`. This can prevent against clickjacking attacks.

> **This header has been superseded by CSP's `frame-ancestors` option**, which has better support in modern browsers (see Content Security Policy for configuration details).

```js
{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }
```

**`Content-Security-Policy`**

> Learn more about adding a Content Security Policy to your application.

(Points at https://nextjs.org/docs/app/guides/content-security-policy.)

### 5.2 Next.js CSP guide: `headers()` without nonces (static-friendly)

https://nextjs.org/docs/app/guides/content-security-policy (version 16.3.1)

Nonce-based CSP **requires dynamic rendering**. For apps that do not use nonces:

> For applications that do not require nonces, you can set the CSP header directly in your `next.config.js` file:

The example uses `async headers()` with `source: '/(.*)'` and `key: 'Content-Security-Policy'`. Production-oriented directives in that example include:

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;
```

(`'unsafe-eval'` is concatenated only when `NODE_ENV === 'development'`.)

> **Good to know**: In development, `'unsafe-eval'` is required because React uses `eval` to provide enhanced debugging information […]. `unsafe-eval` is not required for production. Neither React nor Next.js use `eval` in production by default.

**`frame-ancestors 'none'`** in that official example is the CSP replacement Next.js already called out for clickjacking.

Experimental SRI (`experimental.sri`) is documented as a way to drop `'unsafe-inline'` on scripts while keeping static generation; the page marks it **experimental**.

---

## 6. Recommended CSP for a static marketing site (no inline eval)

Sources:

- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP

### 6.1 What a CSP is (MDN header page)

> The HTTP `Content-Security-Policy` response header allows website administrators to control resources the user agent is allowed to load for a given page. With a few exceptions, policies mostly involve specifying server origins and script endpoints. This helps guard against cross-site scripting attacks.

### 6.2 Do not enable eval

MDN header page, `'unsafe-eval'`:

> By default, if a CSP contains a `default-src` or a `script-src` directive, then JavaScript functions which evaluate their arguments as JavaScript are disabled. This includes eval(), the code argument to setTimeout(), or the Function() constructor.

> Warning: Developers should avoid `'unsafe-eval'`, because it defeats much of the purpose of having a CSP.

MDN example **“Disable unsafe inline code and only allow HTTPS resources”**:

```http
Content-Security-Policy: default-src https:
```

> Because the `unsafe-inline` and `unsafe-eval` directives are not set, inline scripts will be blocked.

### 6.3 Avoid `'unsafe-inline'` (MDN)

MDN CSP guide:

> Warning: Developers should avoid `'unsafe-inline'`, because it defeats much of the purpose of having a CSP. Inline JavaScript is one of the most common XSS vectors, and one of the most basic goals of a CSP is to prevent its uncontrolled use.

### 6.4 Strict / hash CSP is what MDN recommends; hashes fit static pages

MDN CSP guide, “Strict CSP”:

> To control script loading as a mitigation against XSS, recommended practice is to use nonce- or hash- based fetch directives. This is called a strict CSP.

Hash-based example:

```http
Content-Security-Policy:
  script-src 'sha256-{HASHED_SCRIPT}';
  object-src 'none';
  base-uri 'none';
```

> Nonce-based directives are easier to maintain if you can generate responses, including the content itself, dynamically. Otherwise, you need to use hash-based directives.

> Unlike the example using nonces, both the CSP and the content can be static, because the hashes stay the same. This makes hash-based policies more suitable for static pages or websites that rely on client-side rendering.

Scheme-based (also on that guide):

```http
Content-Security-Policy: default-src https:
```

`frame-ancestors` is listed on the MDN **header** page as a navigation directive:

> Specifies valid parents that may embed a page using `<frame>`, `<iframe>`, `<object>`, or `<embed>`.

### 6.5 Tension with Next.js without nonces (do not hide it)

MDN: avoid `'unsafe-inline'` and `'unsafe-eval'`.  
Next.js “Without Nonces” **example still includes** `'unsafe-inline'` on `script-src` and `style-src` because Next/React emit inline scripts/styles unless you use nonces (dynamic) or experimental SRI.

For a **static marketing site**:

- **Do not** ship `'unsafe-eval'` in production (MDN + Next.js both say so).
- **Prefer** hash-based `script-src` (MDN: suitable for static pages) or Next.js experimental SRI + `headers()`.
- If you copy Next.js’s no-nonce example verbatim, you are **explicitly allowing** `'unsafe-inline'` — MDN warns that this defeats much of CSP. That is a framework tradeoff, not an MDN recommendation.

---

## 7. Open Graph image size

### 7.1 ogp.me — required image, optional width/height, **no 1200×630**

https://ogp.me/ (retrieved 2026-08-16)

Required properties include:

> `og:image` - An image URL which should represent your object within the graph.

Structured properties:

> - `og:image:width` - The number of pixels wide.  
> - `og:image:height` - The number of pixels high.  
> - `og:image:alt` - A description of what is in the image (not a caption). If the page specifies an og:image it should specify `og:image:alt`.

The protocol example uses **400×300**, not 1200×630:

```html
<meta property="og:image:width" content="400" />
<meta property="og:image:height" content="300" />
```

**Do not cite ogp.me for 1200×630.** It does not say that.

### 7.2 Facebook Sharing — 1200×630 **is** first-party here

https://developers.facebook.com/docs/sharing/webmasters/images  
(“Images in Link Shares”, page text dated **Updated: Jun 30, 2026**, retrieved 2026-08-16)

> The `og:image` tag can be used to specify the URL of the image that appears when someone shares the content to Facebook.

> - The minimum allowed image dimension is 200 x 200 pixels.  
> - The size of the image file must not exceed 8 MB.  
> - **Use images that are at least 1200 x 630 pixels for the best display on high resolution devices.** At the minimum, you should use images that are 600 x 315 pixels to display link page posts with larger images.  
> - If your image is smaller than 600 x 315 px, it will still display in the link page post, but the size will be much smaller.  
> - […] Try to keep your images as close to **1.91:1** aspect ratio as possible to display the full image in Feed without any cropping.

Next.js `opengraph-image` docs cite this same Facebook page for the **8 MB** `opengraph-image` limit.

### 7.3 Next.js Metadata / `ImageResponse` — 1200×630 as **default and examples**

https://nextjs.org/docs/app/api-reference/functions/image-response (version 16.3.1)

```js
new ImageResponse(
  element: ReactElement,
  options: {
    width?: number = 1200
    height?: number = 630
    …
  },
)
```

https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image (version 16.3.1)

Generated-image examples export:

```js
export const size = {
  width: 1200,
  height: 630,
}
```

Head output in those examples:

```html
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
```

File-based `opengraph-image` also auto-emits `og:image:width` / `og:image:height` from the actual file.

https://nextjs.org/docs/app/api-reference/functions/generate-metadata `openGraph.images` examples use **800×600** and **1800×1600** — Next.js does **not** require 1200×630 in the Metadata API; that size is the **OG image generator default** plus Facebook’s “at least 1200×630” guidance.

---

## 8. JSON-LD XSS — escaping `<` / script-close in `<script>` tags

### 8.1 Google: put JSON-LD in `application/ld+json` (no `\u003c` recipe found)

https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data

> JSON-LD* (Recommended) — A JavaScript notation embedded in a `<script>` tag in the `<head>` and `<body>` elements of an HTML page.

Google Gmail JSON-LD (https://developers.google.com/workspace/gmail/markup/reference/formats/json-ld) shows:

```html
<script type="application/ld+json">
{ "@context": "http://schema.org", … }
</script>
```

**Not found on Google Search Central / Gmail JSON-LD pages fetched for this note:** `JSON.stringify(…).replace(/</g, '\\u003c')` or any other unicode-escape recipe. Do not invent a Google citation for that.

### 8.2 W3C JSON-LD 1.1 §7.2 — first-party JSON-LD rules for HTML `<script>`

https://www.w3.org/TR/json-ld11/#restrictions-for-contents-of-json-ld-script-elements

> JSON-LD content can be easily embedded in HTML [HTML] by placing it in a script element with the `type` attribute set to `application/ld+json`.

§7.2 *Restrictions for contents of JSON-LD `script` elements* (non-normative):

> Due to the HTML Restrictions for contents of `<script>` elements additional encoding restrictions are placed on JSON-LD data contained in script elements.

(The spec links that sentence to  
https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements )

> Authors should avoid using character sequences in scripts embedded in HTML which may be confused with a *comment-open*, *script-open*, *comment-close*, or *script-close*.

> Such content should be escaped as indicated below, however the content will remain escaped after processing through the JSON-LD API [JSON-LD11-API].

From the spec HTML (2026-08-16):

- `&amp;` → `&` (ampersand, U+0026)  
- `&lt;` → `<` (less-than sign, U+003C)  
- `&gt;` → `>` (greater-than sign, U+003E)  
- `&quot;` → `"` (quotation mark, U+0022)  
- `&apos;` → `'` (apostrophe, U+0027)

Example 147 uses a description containing the **HTML-escaped** sequence `&lt;/script&gt;` inside the JSON-LD `<script>` block so the HTML parser does not see a script-close.

That is **HTML entity escaping of `<`**, not JSON `\u003c`. Both prevent a raw `<` (and thus `</script>`) in the HTML source of the data block.

### 8.3 HTML Standard — escape `<` as `\x3C` in script text

https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements  
(fetched 2026-08-16; HTML-to-markdown ate a literal `</script>` in the “easiest and safest” sentence)

Verified example on that page:

```html
<script>
  // Note: `\x3C` is an escape sequence for `<`.
  const example = 'Consider this string: \x3C!-- \x3Cscript>';
  console.log(example);
</script>
```

JSON string escapes use `\uXXXX` (RFC 8259), not `\xHH`. **Composing** HTML’s `\x3C` with JSON yields `\u003c` as the JSON spelling of the same code point. That composition is **not** a sentence on Google’s JSON-LD page.

### 8.4 OWASP XSS Prevention Cheat Sheet

https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

JavaScript contexts:

> Encode all characters using the `\xHH` format.

Dangerous contexts include:

> `<script>Directly in a script</script>`

> Don't place variables into dangerous contexts as even with output encoding, it will not prevent an XSS attack fully.

OWASP’s JSON-specific sentence on that cheat sheet is about **JSON responses**, not JSON-LD in HTML:

> For JSON, verify that the `Content-Type` header is `application/json` and not `text/html` to prevent XSS.

**Do not** treat that `Content-Type` rule as sufficient for JSON-LD embedded in HTML. Use W3C JSON-LD §7.2 + HTML script restrictions for the `<script type="application/ld+json">` case.

### 8.5 `JSON.stringify` and `<`

No first-party page fetched here states that `JSON.stringify` escapes `<`. Combined with §8.2–8.4: if attacker-controlled or even trusted strings can contain `<` / `</script>`, do not concatenate raw `JSON.stringify` output into a HTML `<script>` element without the HTML/JSON-LD escaping those specs describe.
