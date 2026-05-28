var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ShareClipperPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  templateFolder: "templates/web-clipper",
  defaultTemplate: "default",
  watchDelay: 1500
};
var FALLBACK_TEMPLATE = {
  schemaVersion: "0.1.0",
  name: "Default",
  behavior: "create",
  noteNameFormat: "{{title|safe_name}}",
  path: "Clippings",
  noteContentFormat: "{{content}}",
  properties: [
    { name: "title", value: "{{title}}", type: "text" },
    { name: "source", value: "{{url}}", type: "text" },
    {
      name: "author",
      value: '{{author|split:", "|wikilink|join}}',
      type: "text"
    },
    { name: "published", value: "{{published}}", type: "date" },
    { name: "created", value: "{{date}}", type: "date" },
    { name: "description", value: "{{description}}", type: "text" },
    { name: "tags", value: "clipping", type: "multitext" },
    { name: "reason", value: "{{reason}}", type: "text" },
    { name: "category", value: "{{category}}", type: "text" }
  ],
  triggers: []
};
var WCEngine = class {
  constructor(doc, data) {
    this.doc = doc;
    this.data = data;
    this.jsonLd = this.extractJsonLd(doc);
  }
  extractJsonLd(doc) {
    const out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      var _a;
      try {
        const p = JSON.parse((_a = el.textContent) != null ? _a : "");
        if ((p == null ? void 0 : p["@graph"]) && Array.isArray(p["@graph"]))
          out.push(...p["@graph"]);
        else if (Array.isArray(p)) out.push(...p);
        else out.push(p);
      } catch (e) {
      }
    });
    return out;
  }
  resolve(template) {
    return template.replace(/\{\{([\s\S]+?)\}\}/g, (_, expr) => {
      try {
        const v = this.resolveExpr(expr.trim());
        return Array.isArray(v) ? v.join(", ") : String(v);
      } catch (e) {
        return "";
      }
    });
  }
  resolveExpr(expr) {
    const parts = this.splitPipe(expr);
    let val = this.resolveVar(parts[0].trim());
    for (const f of parts.slice(1)) val = this.applyFilter(val, f.trim());
    return val;
  }
  resolveVar(name) {
    if (name.startsWith("selector:"))
      return this.doSelector(name.slice(9), false);
    if (name.startsWith("selectorHtml:"))
      return this.doSelector(name.slice(13), true);
    if (name.startsWith("schema:")) return this.doSchema(name.slice(7));
    if (name.startsWith("meta:")) return this.doMeta(name.slice(5));
    switch (name) {
      case "title":
        return this.data.title;
      case "url":
        return this.data.url;
      case "description":
        return this.data.description;
      case "author":
        return this.data.author;
      case "site":
        return this.data.site;
      case "published":
        return this.data.published;
      case "image":
        return this.data.image;
      case "content":
      case "context":
        return this.data.content;
      case "contentHtml":
        return this.data.contentHtml;
      case "fullHtml":
        return this.data.fullHtml;
      case "date":
        return (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      case "time":
        return (/* @__PURE__ */ new Date()).toISOString();
      case "highlights":
      case "selection":
      case "selectionHtml":
        return "";
      case "reason":
        return this.data.reason;
      case "category":
        return this.data.category;
      default:
        return "";
    }
  }
  doSelector(expr, asHtml) {
    const qi = expr.lastIndexOf("?");
    let css = expr, attr = "";
    if (qi > 0) {
      css = expr.slice(0, qi);
      attr = expr.slice(qi + 1);
    }
    const els = Array.from(this.doc.querySelectorAll(css));
    return els.map((el) => {
      var _a, _b, _c;
      if (attr) return (_a = el.getAttribute(attr)) != null ? _a : "";
      if (asHtml) return el.innerHTML.trim();
      return (_c = (_b = el.textContent) == null ? void 0 : _b.trim()) != null ? _c : "";
    });
  }
  doSchema(path) {
    let type = "", keyPath = path;
    if (path.startsWith("@")) {
      const ci = path.indexOf(":");
      if (ci !== -1) {
        type = path.slice(1, ci);
        keyPath = path.slice(ci + 1);
      } else {
        type = path.slice(1);
        keyPath = "";
      }
    }
    const schemas = type ? this.jsonLd.filter((s) => {
      const t = s["@type"];
      return t === type || Array.isArray(t) && t.includes(type);
    }) : this.jsonLd;
    for (const s of schemas) {
      const v = this.deepGet(s, keyPath);
      if (v != null) {
        if (Array.isArray(v)) {
          const domItems = keyPath ? this.domItemprop(keyPath.replace(/\[.*$/, "")) : [];
          if (domItems.length > 0) return domItems;
          return v.map((x) => this.schemaStr(x));
        }
        return this.schemaStr(v);
      }
    }
    return "";
  }
  domItemprop(name) {
    var _a;
    const els = Array.from(this.doc.querySelectorAll(`[itemprop="${name}"]`));
    if (els.length === 0) return [];
    const results = [];
    for (const el of els) {
      const html = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
      const tmp = this.doc.createElement("div");
      tmp.innerHTML = html;
      const text = (_a = tmp.textContent) != null ? _a : "";
      for (const part of text.split("\n")) {
        const t = part.trim();
        if (t) results.push(t);
      }
    }
    return results;
  }
  deepGet(obj, path) {
    if (!path) return obj;
    let cur = obj;
    for (const part of path.split(".")) {
      const m = part.match(/^(.+?)\[(\d+|\*)\]$/);
      if (m) {
        cur = cur == null ? void 0 : cur[m[1]];
        if (!Array.isArray(cur)) return void 0;
        cur = m[2] === "*" ? cur : cur[parseInt(m[2])];
      } else {
        if (Array.isArray(cur)) {
          const mapped = cur.map((item) => item == null ? void 0 : item[part]).filter((v) => v != null);
          cur = mapped.length > 0 ? mapped : void 0;
        } else {
          cur = cur == null ? void 0 : cur[part];
        }
      }
      if (cur == null) return void 0;
    }
    return cur;
  }
  schemaStr(v) {
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (typeof v === "object" && v !== null) {
      const o = v;
      if (o.text) return String(o.text);
      if (o.name) return String(o.name);
      if (o["@value"]) return String(o["@value"]);
    }
    return JSON.stringify(v);
  }
  doMeta(name) {
    var _a, _b;
    return ((_a = this.doc.querySelector(`meta[name="${name}"]`)) == null ? void 0 : _a.getAttribute("content")) || ((_b = this.doc.querySelector(`meta[property="${name}"]`)) == null ? void 0 : _b.getAttribute("content")) || "";
  }
  applyFilter(val, f) {
    var _a, _b, _c;
    const ci = f.indexOf(":");
    const name = ci === -1 ? f : f.slice(0, ci);
    const arg = ci === -1 ? "" : f.slice(ci + 1).trim();
    if (Array.isArray(val)) {
      switch (name) {
        case "join":
          return val.join((_a = this.strArg(arg)) != null ? _a : "");
        case "first":
          return (_b = val[0]) != null ? _b : "";
        case "slice":
          return this.sliceArr(val, arg);
        case "wikilink":
          return val.map((v) => this.mkWikilink(v, arg));
        case "markdown":
          return val.map((v) => this.toMarkdown(v));
        case "trim":
          return val.map((v) => v.trim());
        case "lower":
          return val.map((v) => v.toLowerCase());
        case "upper":
          return val.map((v) => v.toUpperCase());
        case "replace":
          return val.map((v) => this.doReplace(v, arg));
        case "unique":
          return [...new Set(val)];
        case "link":
          return val.map((v) => `[${this.strArg(arg) || v}](${v})`);
        case "blockquote":
          return val.map(
            (v) => v.split("\n").map((l) => "> " + l).join("\n")
          );
        case "list":
          return val.map((v) => arg === "task" ? `- [ ] ${v}` : `- ${v}`).join("\n");
        case "strip_tags":
          return val.map((v) => v.replace(/<[^>]+>/g, ""));
        default: {
          const mapped = val.map((v) => this.applyFilter(v, f));
          return mapped.flat();
        }
      }
    }
    switch (name) {
      case "date":
        return this.formatDate(val, arg);
      case "safe_name":
        return val.replace(/[\\/\s:*?"<>|#^[\]]/g, (c) => c.match(/\s/) ? " " : "").replace(/\s+/g, " ").trim();
      case "trim":
        return val.trim();
      case "lower":
        return val.toLowerCase();
      case "upper":
        return val.toUpperCase();
      case "capitalize":
        return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
      case "title":
        return val.replace(/\b\w/g, (c) => c.toUpperCase());
      case "uncamel":
        return val.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase();
      case "markdown":
        return this.toMarkdown(val);
      case "strip_tags":
        return val.replace(/<[^>]+>/g, "");
      case "strip_attr":
        return val.replace(/<(\w[\w-]*)(\s[^>]*)>/g, "<$1>");
      case "wikilink":
        return this.mkWikilink(val, arg);
      case "split":
        return val.split((_c = this.strArg(arg)) != null ? _c : "");
      case "slice":
        return this.sliceStr(val, arg);
      case "replace":
        return this.doReplace(val, arg);
      case "join":
        return val;
      case "first":
        return val;
      case "unique":
        return val;
      case "blockquote":
        return val.split("\n").map((l) => "> " + l).join("\n");
      case "callout":
        return this.mkCallout(val, arg);
      case "link":
        return `[${this.strArg(arg) || val}](${val})`;
      case "list":
        return arg === "task" ? `- [ ] ${val}` : `- ${val}`;
      default:
        return val;
    }
  }
  mkWikilink(val, arg) {
    const alias = this.strArg(arg);
    return alias ? `[[${val}|${alias}]]` : `[[${val}]]`;
  }
  formatDate(val, arg) {
    const fmt = this.strArg(arg) || "YYYY-MM-DD";
    const d = val ? new Date(val) : /* @__PURE__ */ new Date();
    if (isNaN(d.getTime())) return val;
    return fmt.replace("YYYY", String(d.getFullYear())).replace("MM", String(d.getMonth() + 1).padStart(2, "0")).replace("DD", String(d.getDate()).padStart(2, "0")).replace("HH", String(d.getHours()).padStart(2, "0")).replace("mm", String(d.getMinutes()).padStart(2, "0")).replace("ss", String(d.getSeconds()).padStart(2, "0"));
  }
  sliceStr(val, arg) {
    const [a, b] = arg.split(",").map((n) => parseInt(n.trim()));
    return isNaN(b) ? val.slice(a) : val.slice(a, b);
  }
  sliceArr(val, arg) {
    const [a, b] = arg.split(",").map((n) => parseInt(n.trim()));
    return isNaN(b) ? val.slice(a) : val.slice(a, b);
  }
  doReplace(val, arg) {
    arg = arg.trim();
    if (arg.startsWith("(")) {
      const inner = arg.slice(1, arg.lastIndexOf(")"));
      for (const [from, to] of this.parsePairs(inner))
        val = this.replaceOne(val, from, to);
      return val;
    }
    const parts = this.parseQuotedPair(arg);
    return parts.length >= 2 ? this.replaceOne(val, parts[0], parts[1]) : val;
  }
  replaceOne(val, from, to) {
    const m = from.match(/^\/(.+)\/([gimsuy]*)$/);
    if (m) {
      try {
        return val.replace(new RegExp(m[1], m[2] || "g"), to);
      } catch (e) {
        return val;
      }
    }
    return val.split(from).join(to);
  }
  parsePairs(inner) {
    const pairs = [];
    const re = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(inner)) !== null)
      pairs.push([this.unescape(m[1]), this.unescape(m[2])]);
    return pairs;
  }
  parseQuotedPair(arg) {
    const result = [];
    let i = 0;
    while (i < arg.length) {
      if (arg[i] === '"') {
        let s = "";
        i++;
        while (i < arg.length && arg[i] !== '"') {
          s += arg[i] === "\\" && i + 1 < arg.length ? arg[++i] : arg[i];
          i++;
        }
        i++;
        result.push(s);
        while (i < arg.length && (arg[i] === ":" || arg[i] === " ")) i++;
      } else {
        i++;
      }
    }
    return result;
  }
  strArg(arg) {
    arg = arg.trim();
    if (arg.startsWith('"') && arg.endsWith('"') || arg.startsWith("'") && arg.endsWith("'"))
      return this.unescape(arg.slice(1, -1));
    return arg;
  }
  unescape(s) {
    return s.replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  mkCallout(val, arg) {
    var _a, _b;
    const m = arg.match(
      /\(\s*"([^"]*)"\s*(?:,\s*"([^"]*)"\s*)?(?:,\s*(true|false|null)\s*)?\)/
    );
    const type = (_a = m == null ? void 0 : m[1]) != null ? _a : "info";
    const title = (_b = m == null ? void 0 : m[2]) != null ? _b : "";
    const fold = (m == null ? void 0 : m[3]) === "true" ? "+" : (m == null ? void 0 : m[3]) === "false" ? "-" : "";
    return `> [!${type}]${fold}${title ? " " + title : ""}
${val.split("\n").map((l) => "> " + l).join("\n")}`;
  }
  toMarkdown(html) {
    const d = new DOMParser().parseFromString(html, "text/html");
    ["script", "style", "svg", "noscript"].forEach(
      (t) => d.querySelectorAll(t).forEach((e) => e.remove())
    );
    return this.walkNode(d.body).replace(/\n{3,}/g, "\n\n").trim();
  }
  walkNode(node) {
    var _a, _b;
    if (node.nodeType === Node.TEXT_NODE)
      return ((_a = node.textContent) == null ? void 0 : _a.replace(/\s+/g, " ")) || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "svg", "noscript"].includes(tag)) return "";
    const kids = Array.from(node.childNodes).map((c) => this.walkNode(c)).join("");
    switch (tag) {
      case "h1":
        return `
# ${kids.trim()}
`;
      case "h2":
        return `
## ${kids.trim()}
`;
      case "h3":
        return `
### ${kids.trim()}
`;
      case "h4":
        return `
#### ${kids.trim()}
`;
      case "h5":
        return `
##### ${kids.trim()}
`;
      case "h6":
        return `
###### ${kids.trim()}
`;
      case "p":
        return `
${kids.trim()}
`;
      case "br":
        return "\n";
      case "strong":
      case "b":
        return `**${kids}**`;
      case "em":
      case "i":
        return `*${kids}*`;
      case "s":
      case "del":
        return `~~${kids}~~`;
      case "a": {
        const h = el.getAttribute("href");
        return h ? `[${kids}](${h})` : kids;
      }
      case "img": {
        const s = el.getAttribute("src") || "";
        const a = el.getAttribute("alt") || "";
        return s ? `![${a}](${s})` : "";
      }
      case "ul":
      case "ol":
        return `
${kids}
`;
      case "li":
        return `
- ${kids.trim()}`;
      case "blockquote":
        return `
> ${kids.trim()}
`;
      case "code":
        return el.closest("pre") ? kids : `\`${kids}\``;
      case "pre":
        return `
\`\`\`
${(_b = el.textContent) == null ? void 0 : _b.trim()}
\`\`\`
`;
      case "hr":
        return "\n---\n";
      case "table":
        return `
${kids}
`;
      case "thead":
      case "tbody":
      case "tr":
        return kids;
      case "th":
        return `| ${kids.trim()} `;
      case "td":
        return `| ${kids.trim()} `;
      default:
        return kids;
    }
  }
  splitPipe(expr) {
    const parts = [];
    let cur = "", depth = 0, inStr = false, sc = "";
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (inStr) {
        cur += ch;
        if (ch === sc && expr[i - 1] !== "\\") inStr = false;
      } else if (ch === '"' || ch === "'") {
        inStr = true;
        sc = ch;
        cur += ch;
      } else if (ch === "(") {
        depth++;
        cur += ch;
      } else if (ch === ")") {
        depth--;
        cur += ch;
      } else if (ch === "|" && depth === 0) {
        parts.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur) parts.push(cur);
    return parts;
  }
};
function buildFrontmatter(properties, engine) {
  const lines = ["---"];
  for (const prop of properties)
    lines.push(yamlLine(prop.name, engine.resolve(prop.value), prop.type));
  lines.push("---");
  return lines.join("\n");
}
function yamlLine(name, value, type) {
  if (type === "multitext" || type === "tags") {
    const arr = (Array.isArray(value) ? value : [value]).filter(Boolean);
    if (arr.length === 0) return `${name}:`;
    return `${name}:
` + arr.map((v) => `  - ${yamlScalar(v)}`).join("\n");
  }
  if (type === "checkbox")
    return `${name}: ${value === "true" || value === "1"}`;
  if (type === "number") return `${name}: ${parseFloat(String(value)) || 0}`;
  const str = Array.isArray(value) ? value.join(", ") : String(value);
  if (!str) return `${name}:`;
  return `${name}: ${yamlScalar(str)}`;
}
function yamlScalar(v) {
  if (/[:#\[\]{},|>&*!'"@`\n]/.test(v) || v.trim() !== v)
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return v;
}
function parseTemplateNote(content) {
  let json = content.trim();
  const fence = json.match(/^```(?:json)?\s*\n([\s\S]+?)\n```\s*$/);
  if (fence) json = fence[1].trim();
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}
function templateMatchesUrl(tpl, url) {
  var _a;
  for (const trigger of (_a = tpl.triggers) != null ? _a : []) {
    if (!trigger || trigger.startsWith("schema:")) continue;
    if (trigger.startsWith("/") && trigger.lastIndexOf("/") > 0) {
      const last = trigger.lastIndexOf("/");
      try {
        if (new RegExp(trigger.slice(1, last), trigger.slice(last + 1)).test(url))
          return true;
      } catch (e) {
      }
    } else {
      if (url.startsWith(trigger) || url.includes(trigger)) return true;
    }
  }
  return false;
}
function buildNote(tpl, engine) {
  var _a, _b;
  const fm = buildFrontmatter((_a = tpl.properties) != null ? _a : [], engine);
  let body = (_b = tpl.noteContentFormat) != null ? _b : "{{content}}";
  if (tpl.context)
    body = body.replace(/\{\{context\}\}/g, engine.resolve(tpl.context));
  return `${fm}

${engine.resolve(body).replace(/\\n/g, "\n")}`;
}
function injectStyles() {
  if (document.getElementById("share-clipper-styles")) return;
  const s = document.createElement("style");
  s.id = "share-clipper-styles";
  s.textContent = `
    .sc-modal { padding: 8px; }
    .sc-modal h2 { margin-bottom: 14px; }
    .sc-two-col { display:flex; gap:16px; min-height:440px; }
    .sc-sidebar { width:190px; flex-shrink:0; display:flex; flex-direction:column; gap:5px; overflow-y:auto; }
    .sc-main { flex:1; display:flex; flex-direction:column; gap:8px; }
    .sc-label { display:block; font-size:.82em; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); margin:14px 0 4px; }
    .sc-label:first-child { margin-top:0; }
    .sc-input { width:100%; padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); font-size:1em; box-sizing:border-box; }
    .sc-select { width:100%; padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); font-size:1em; box-sizing:border-box; cursor:pointer; }
    .sc-textarea { width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); font-size:.88em; resize:vertical; box-sizing:border-box; font-family:var(--font-monospace); line-height:1.55; flex:1; }
    .sc-chips-label { font-size:.8em; color:var(--text-muted); margin:6px 0 4px; }
    .sc-chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
    .sc-chip { padding:4px 12px; border-radius:999px; border:1px solid var(--background-modifier-border); background:var(--background-secondary); color:var(--text-normal); cursor:pointer; font-size:.88em; transition:all .12s; }
    .sc-chip:hover { background:var(--background-modifier-hover); }
    .sc-chip-selected { background:var(--interactive-accent) !important; color:var(--text-on-accent) !important; border-color:var(--interactive-accent) !important; }
    .sc-tpl-item { padding:7px 10px; border-radius:6px; cursor:pointer; border:1px solid transparent; font-size:.9em; background:var(--background-secondary); display:flex; justify-content:space-between; align-items:center; }
    .sc-tpl-item:hover { background:var(--background-modifier-hover); }
    .sc-tpl-item.active { background:var(--interactive-accent); color:var(--text-on-accent); }
    .sc-tpl-del { background:none; border:none; cursor:pointer; color:var(--text-muted); font-size:1em; padding:0 2px; opacity:.6; }
    .sc-tpl-del:hover { opacity:1; color:var(--text-error); }
    .sc-tpl-item.active .sc-tpl-del { color:var(--text-on-accent); }
    .sc-var-row { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; }
    .sc-var-pill { padding:2px 7px; border-radius:4px; font-size:.75em; background:var(--background-secondary); border:1px solid var(--background-modifier-border); cursor:pointer; font-family:var(--font-monospace); color:var(--text-accent); }
    .sc-var-pill:hover { background:var(--background-modifier-hover); }
    .sc-btn-row { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }
    .sc-btn-spread { display:flex; justify-content:space-between; gap:8px; margin-top:16px; }
    .sc-btn { padding:7px 16px; border-radius:6px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary); color:var(--text-normal); font-size:.9em; }
    .sc-btn:hover { background:var(--background-modifier-hover); }
    .sc-btn-accent { padding:7px 18px; border-radius:6px; border:none; cursor:pointer; background:var(--interactive-accent); color:var(--text-on-accent); font-weight:600; font-size:.9em; }
    .sc-btn-accent:hover { filter:brightness(1.1); }
    .sc-btn-danger { padding:7px 14px; border-radius:6px; border:none; cursor:pointer; background:var(--background-modifier-error); color:var(--text-error); font-size:.9em; }
    .sc-divider { border:none; border-top:1px solid var(--background-modifier-border); margin:10px 0; }
    .sc-hint { font-size:.8em; color:var(--text-muted); margin:4px 0 0; }
    .sc-status { font-size:.8em; color:var(--color-green); }
  `;
  document.head.appendChild(s);
}
var SaveDialog = class extends import_obsidian.Modal {
  constructor(app, templates, autoSelect, categories, resolvedNames, resolve) {
    var _a, _b, _c;
    super(app);
    this.selName = "";
    this.reasonVal = "";
    this.catVal = "";
    this.noteNameVal = "";
    this.pathVal = "";
    this.templates = templates;
    this.autoSelect = autoSelect;
    this.categories = categories;
    this.resolvedNames = resolvedNames;
    this.resolve = resolve;
    this.selName = autoSelect || ((_a = templates[0]) == null ? void 0 : _a.name) || "";
    const initial = resolvedNames.get(this.selName);
    this.pathVal = (_b = initial == null ? void 0 : initial.path) != null ? _b : "";
    this.noteNameVal = (_c = initial == null ? void 0 : initial.noteName) != null ? _c : "";
  }
  onOpen() {
    injectStyles();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("sc-modal");
    contentEl.createEl("h2", { text: "Save Clipping" });
    if (this.templates.length > 1) {
      contentEl.createEl("label", { text: "Template", cls: "sc-label" });
      const sel = contentEl.createEl("select", {
        cls: "sc-select"
      });
      for (const t of this.templates) {
        const opt = sel.createEl("option", { text: t.name });
        opt.value = t.name;
        if (t.name === this.selName) opt.selected = true;
      }
      sel.addEventListener("change", () => {
        this.selName = sel.value;
        const r = this.resolvedNames.get(sel.value);
        if (r) {
          pathInput.value = r.path;
          this.pathVal = r.path;
          nameInput.value = r.noteName;
          this.noteNameVal = r.noteName;
        }
      });
      if (this.autoSelect)
        contentEl.createEl("p", {
          text: `\u2191 Auto-selected by URL trigger`,
          cls: "sc-hint"
        });
    }
    contentEl.createEl("label", { text: "Folder", cls: "sc-label" });
    const pathInput = contentEl.createEl("input", {
      type: "text",
      cls: "sc-input"
    });
    pathInput.value = this.pathVal;
    pathInput.placeholder = "e.g. Clippings";
    pathInput.addEventListener("input", () => {
      this.pathVal = pathInput.value;
    });
    contentEl.createEl("label", { text: "File name", cls: "sc-label" });
    const nameInput = contentEl.createEl("input", {
      type: "text",
      cls: "sc-input"
    });
    nameInput.value = this.noteNameVal;
    nameInput.placeholder = "Note name (without .md)";
    nameInput.addEventListener("input", () => {
      this.noteNameVal = nameInput.value;
    });
    contentEl.createEl("label", {
      text: "Why are you saving this?",
      cls: "sc-label"
    });
    const reasonInput = contentEl.createEl("textarea", { cls: "sc-textarea" });
    reasonInput.placeholder = "Research, writing reference, thriller craft\u2026";
    reasonInput.rows = 3;
    reasonInput.style.minHeight = "unset";
    reasonInput.addEventListener("input", () => {
      this.reasonVal = reasonInput.value;
    });
    contentEl.createEl("label", { text: "Category", cls: "sc-label" });
    const catWrap = contentEl.createDiv();
    if (this.categories.length > 0) {
      catWrap.createEl("p", { text: "Existing:", cls: "sc-chips-label" });
      const chips = catWrap.createDiv({ cls: "sc-chips" });
      for (const cat of this.categories) {
        const chip = chips.createEl("button", { text: cat, cls: "sc-chip" });
        chip.addEventListener("click", () => {
          chips.querySelectorAll(".sc-chip").forEach((c) => c.removeClass("sc-chip-selected"));
          chip.addClass("sc-chip-selected");
          this.catVal = cat;
          newCat.value = "";
        });
      }
    }
    catWrap.createEl("p", {
      text: this.categories.length ? "Or new:" : "Category:",
      cls: "sc-chips-label"
    });
    const newCat = catWrap.createEl("input", { type: "text", cls: "sc-input" });
    newCat.placeholder = "Writing Craft, Research, Tools\u2026";
    newCat.addEventListener("input", () => {
      if (newCat.value) {
        catWrap.querySelectorAll(".sc-chip").forEach((c) => c.removeClass("sc-chip-selected"));
        this.catVal = newCat.value;
      }
    });
    const btnRow = contentEl.createDiv({ cls: "sc-btn-row" });
    btnRow.createEl("button", { text: "Cancel", cls: "sc-btn" }).addEventListener("click", () => {
      this.resolve(null);
      this.close();
    });
    btnRow.createEl("button", { text: "Save", cls: "sc-btn-accent" }).addEventListener("click", () => this.submit());
    newCat.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });
    setTimeout(() => reasonInput.focus(), 50);
  }
  submit() {
    this.resolve({
      templateName: this.selName,
      reason: this.reasonVal.trim(),
      category: this.catVal.trim(),
      noteName: this.noteNameVal.trim(),
      path: this.pathVal.trim()
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
function resolveTemplateNames(templates, doc, pageData) {
  var _a;
  const map = /* @__PURE__ */ new Map();
  for (const t of templates) {
    const eng = new WCEngine(doc, { ...pageData, reason: "", category: "" });
    const raw = t.tpl.noteNameFormat ? eng.resolve(t.tpl.noteNameFormat) : pageData.title;
    const noteName = raw.replace(/[\\/:*?"<>|]/g, "").substring(0, 80).trim() || "Clipping";
    map.set(t.name, { path: (_a = t.tpl.path) != null ? _a : "", noteName });
  }
  return map;
}
var VARIABLE_REFERENCE = [
  { token: "{{title}}", desc: "Page title" },
  { token: "{{url}}", desc: "Page URL" },
  { token: "{{description}}", desc: "Meta description" },
  { token: "{{author}}", desc: "Author" },
  { token: "{{site}}", desc: "Site name" },
  { token: "{{published}}", desc: "Publish date" },
  { token: "{{image}}", desc: "OG image URL" },
  { token: "{{content}}", desc: "Article body (markdown)" },
  { token: "{{contentHtml}}", desc: "Article body (HTML)" },
  { token: "{{date}}", desc: "Today YYYY-MM-DD" },
  { token: "{{time}}", desc: "Current ISO timestamp" },
  { token: "{{reason}}", desc: "Why saved (plugin extra)" },
  { token: "{{category}}", desc: "Category (plugin extra)" },
  { token: "{{selector:.class}}", desc: "CSS selector \u2192 text" },
  { token: "{{selectorHtml:article}}", desc: "CSS selector \u2192 HTML" },
  { token: "{{schema:@Type:key}}", desc: "JSON-LD schema" },
  { token: "{{meta:name}}", desc: "Meta tag by name" }
];
var FILTER_REFERENCE = [
  'date:"YYYY-MM-DD"',
  "safe_name",
  "trim",
  "lower",
  "upper",
  "capitalize",
  "title",
  "markdown",
  "strip_tags",
  "wikilink",
  'split:", "',
  'join:", "',
  "slice:0,8000",
  'replace:"from":"to"',
  "first",
  "blockquote",
  "unique",
  "link"
];
var TemplateBuilderModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.notes = /* @__PURE__ */ new Map();
    this.selected = "";
    this.isDirty = false;
    this.plugin = plugin;
  }
  async onOpen() {
    injectStyles();
    this.modalEl.style.width = "min(900px, 96vw)";
    this.modalEl.style.height = "min(680px, 92vh)";
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("sc-modal");
    contentEl.style.cssText = "display:flex; flex-direction:column; height:100%;";
    const hdr = contentEl.createDiv({ cls: "sc-btn-spread" });
    hdr.style.cssText = "align-items:center; margin-top:0;";
    hdr.createEl("h2", { text: "Template Builder" }).style.margin = "0";
    hdr.createEl("button", { text: "+ New Template", cls: "sc-btn-accent" }).addEventListener("click", () => this.newTemplate());
    contentEl.createEl("p", {
      text: `Folder: ${this.plugin.settings.templateFolder}  \xB7  Each note's content is Web Clipper JSON`,
      cls: "sc-hint"
    });
    contentEl.createEl("hr", { cls: "sc-divider" });
    const cols = contentEl.createDiv({ cls: "sc-two-col" });
    cols.style.cssText = "flex:1; overflow:hidden;";
    this.sidebarEl = cols.createDiv({ cls: "sc-sidebar" });
    this.editorEl = cols.createDiv({ cls: "sc-main" });
    this.editorEl.style.overflow = "hidden";
    this.editorEl.createEl("label", {
      text: "Variables \u2014 click to copy",
      cls: "sc-label"
    }).style.marginTop = "0";
    const varRow = this.editorEl.createDiv({ cls: "sc-var-row" });
    for (const v of VARIABLE_REFERENCE) {
      const pill = varRow.createEl("button", {
        text: v.token,
        cls: "sc-var-pill"
      });
      pill.title = v.desc;
      pill.addEventListener("click", () => {
        navigator.clipboard.writeText(v.token);
        new import_obsidian.Notice(`Copied ${v.token}`);
      });
    }
    this.editorEl.createEl("label", {
      text: "Common filters",
      cls: "sc-label"
    });
    const filterRow = this.editorEl.createDiv({ cls: "sc-var-row" });
    for (const f of FILTER_REFERENCE) {
      const pill = filterRow.createEl("button", {
        text: f,
        cls: "sc-var-pill"
      });
      pill.style.color = "var(--text-muted)";
      pill.addEventListener("click", () => {
        navigator.clipboard.writeText(f);
        new import_obsidian.Notice(`Copied ${f}`);
      });
    }
    this.editorEl.createEl("label", { text: "Template JSON", cls: "sc-label" });
    this.jsonEl = this.editorEl.createEl("textarea", { cls: "sc-textarea" });
    this.jsonEl.style.cssText = "flex:1; min-height:180px;";
    this.jsonEl.addEventListener("input", () => {
      this.isDirty = true;
    });
    const bRow = this.editorEl.createDiv({ cls: "sc-btn-spread" });
    bRow.style.marginTop = "8px";
    this.statusEl = bRow.createEl("span", { cls: "sc-status" });
    const rBtns = bRow.createDiv({ cls: "sc-btn-row" });
    rBtns.style.marginTop = "0";
    rBtns.createEl("button", { text: "Delete", cls: "sc-btn-danger" }).addEventListener("click", () => this.deleteTemplate());
    rBtns.createEl("button", { text: "Save", cls: "sc-btn-accent" }).addEventListener("click", () => this.saveTemplate());
    await this.loadNotes();
    this.renderSidebar();
    const first = Array.from(this.notes.keys())[0];
    if (first) this.selectNote(first);
    else this.editorEl.style.opacity = "0.5";
  }
  async loadNotes() {
    this.notes.clear();
    await this.plugin.ensureFolder(this.plugin.settings.templateFolder);
    const folder = this.app.vault.getAbstractFileByPath(
      this.plugin.settings.templateFolder
    );
    if (!(folder instanceof import_obsidian.TFolder)) return;
    for (const child of folder.children)
      if (child instanceof import_obsidian.TFile && child.extension === "md")
        this.notes.set(child.basename, await this.app.vault.read(child));
  }
  renderSidebar() {
    this.sidebarEl.empty();
    if (this.notes.size === 0) {
      this.sidebarEl.createEl("p", {
        text: "No templates yet.",
        cls: "sc-hint"
      });
      return;
    }
    for (const name of this.notes.keys()) {
      const item = this.sidebarEl.createDiv({
        cls: "sc-tpl-item" + (name === this.selected ? " active" : "")
      });
      item.createEl("span", { text: name });
      const del = item.createEl("button", { text: "\u2715", cls: "sc-tpl-del" });
      del.title = "Delete";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        this.selected = name;
        await this.deleteTemplate();
      });
      item.addEventListener("click", () => {
        if (this.isDirty && this.selected !== name && !confirm(`Discard unsaved changes to "${this.selected}"?`))
          return;
        this.selectNote(name);
      });
    }
  }
  selectNote(name) {
    var _a;
    this.selected = name;
    this.jsonEl.value = (_a = this.notes.get(name)) != null ? _a : "";
    this.editorEl.style.opacity = "1";
    this.isDirty = false;
    this.statusEl.textContent = "";
    this.renderSidebar();
  }
  newTemplate() {
    const name = `New Template ${this.notes.size + 1}`;
    this.notes.set(
      name,
      JSON.stringify({ ...FALLBACK_TEMPLATE, name }, null, 2)
    );
    this.renderSidebar();
    this.selectNote(name);
    this.isDirty = true;
  }
  async saveTemplate() {
    const json = this.jsonEl.value.trim();
    if (!json) {
      new import_obsidian.Notice("Template is empty");
      return;
    }
    try {
      JSON.parse(json);
    } catch (e) {
      new import_obsidian.Notice(`Invalid JSON: ${e.message}`);
      return;
    }
    let saveName = this.selected;
    try {
      const p = JSON.parse(json);
      if (p.name) saveName = p.name;
    } catch (e) {
    }
    const folder = this.plugin.settings.templateFolder;
    if (this.selected !== saveName) {
      const old = this.app.vault.getAbstractFileByPath(
        `${folder}/${this.selected}.md`
      );
      if (old instanceof import_obsidian.TFile) await this.app.vault.delete(old);
      this.notes.delete(this.selected);
    }
    const newPath = `${folder}/${saveName}.md`;
    const existing = this.app.vault.getAbstractFileByPath(newPath);
    if (existing instanceof import_obsidian.TFile) await this.app.vault.modify(existing, json);
    else await this.app.vault.create(newPath, json);
    this.notes.set(saveName, json);
    this.selected = saveName;
    this.isDirty = false;
    this.statusEl.textContent = "\u2713 Saved";
    setTimeout(() => {
      this.statusEl.textContent = "";
    }, 2e3);
    this.renderSidebar();
  }
  async deleteTemplate() {
    if (!this.selected || !confirm(`Delete template "${this.selected}"?`))
      return;
    const file = this.app.vault.getAbstractFileByPath(
      `${this.plugin.settings.templateFolder}/${this.selected}.md`
    );
    if (file instanceof import_obsidian.TFile) await this.app.vault.delete(file);
    this.notes.delete(this.selected);
    this.selected = "";
    const remaining = Array.from(this.notes.keys());
    if (remaining.length) this.selectNote(remaining[0]);
    else {
      this.jsonEl.value = "";
      this.editorEl.style.opacity = "0.5";
    }
    this.renderSidebar();
    new import_obsidian.Notice("Template deleted");
  }
  onClose() {
    this.contentEl.empty();
  }
};
var URL_PATTERN = /^https?:\/\/[^\s]+$/m;
function isRawUrlNote(content) {
  const t = content.trim();
  return URL_PATTERN.test(t) && t.split("\n").length <= 3;
}
var ShareClipperPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.processing = /* @__PURE__ */ new Set();
  }
  async onload() {
    await this.loadSettings();
    this.registerEvent(
      this.app.vault.on("create", async (file) => {
        if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") return;
        setTimeout(() => this.checkAndClip(file), this.settings.watchDelay);
      })
    );
    this.registerObsidianProtocolHandler("share-clipper", async (params) => {
      if (!params.url) {
        new import_obsidian.Notice("Share Clipper: no URL");
        return;
      }
      await this.clipUrl(params.url);
    });
    this.addCommand({
      id: "clip-clipboard",
      name: "Clip URL from clipboard",
      callback: async () => {
        const text = await navigator.clipboard.readText().catch(() => "");
        const match = text.trim().match(/https?:\/\/[^\s]+/);
        if (!match) {
          new import_obsidian.Notice("No URL in clipboard");
          return;
        }
        await this.clipUrl(match[0]);
      }
    });
    this.addCommand({
      id: "template-builder",
      name: "Open template builder",
      callback: () => new TemplateBuilderModal(this.app, this).open()
    });
    this.addSettingTab(new ShareClipperSettingTab(this.app, this));
  }
  // ── Template management ──────────────────────────────────────────────────
  async ensureFolder(path) {
    if (!path) return;
    let cur = "";
    for (const part of path.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur))
        await this.app.vault.createFolder(cur);
    }
  }
  async loadTemplates() {
    const folder = this.app.vault.getAbstractFileByPath(
      this.settings.templateFolder
    );
    const result = [];
    if (folder instanceof import_obsidian.TFolder) {
      for (const child of folder.children) {
        if (!(child instanceof import_obsidian.TFile) || child.extension !== "md") continue;
        const tpl = parseTemplateNote(await this.app.vault.read(child));
        if (tpl) result.push({ name: tpl.name || child.basename, tpl });
      }
    }
    if (result.length === 0)
      result.push({ name: FALLBACK_TEMPLATE.name, tpl: FALLBACK_TEMPLATE });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  // ── Page fetching — returns null on any failure, never throws ────────────
  async fetchPage(url) {
    try {
      const resp = await (0, import_obsidian.requestUrl)({
        url,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const html = resp.text;
      return { doc: new DOMParser().parseFromString(html, "text/html"), html };
    } catch (e) {
      return null;
    }
  }
  // ── Error helpers ────────────────────────────────────────────────────────
  // Written into the note body when an unexpected mid-clip error occurs.
  errorContent(url, context, err) {
    var _a, _b, _c;
    const e = err;
    const hostname = (() => {
      try {
        return new URL(url).hostname;
      } catch (e2) {
        return url;
      }
    })();
    return [
      `> [!warning] Clipping Failed`,
      `> An unexpected error occurred. The URL has been preserved.`,
      ``,
      `**URL:** ${url}`,
      `**Site:** ${hostname}`,
      `**Failed at:** ${context}`,
      `**Time:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
      ``,
      `## Debug Info`,
      `\`\`\``,
      `Message : ${(_a = e == null ? void 0 : e.message) != null ? _a : String(err)}`,
      `Name    : ${(_b = e == null ? void 0 : e.name) != null ? _b : "Unknown"}`,
      `Stack   : ${(_c = e == null ? void 0 : e.stack) != null ? _c : "unavailable"}`,
      `\`\`\``
    ].join("\n");
  }
  // Minimal PageData for sites that block fetching.
  // Lets the template engine still produce proper frontmatter with the URL intact.
  blockedPageData(url) {
    const hostname = (() => {
      try {
        return new URL(url).hostname;
      } catch (e) {
        return url;
      }
    })();
    return {
      title: hostname,
      url,
      description: "",
      author: "",
      site: hostname,
      published: "",
      image: "",
      content: [
        `> [!warning] Fetch Blocked`,
        `> This site blocked automated fetching. The URL has been saved.`,
        ``,
        `**URL:** ${url}`,
        `**Site:** ${hostname}`,
        `**Time:** ${(/* @__PURE__ */ new Date()).toISOString()}`
      ].join("\n"),
      contentHtml: "",
      fullHtml: "",
      reason: "",
      category: ""
    };
  }
  // ── Data extraction ──────────────────────────────────────────────────────
  extractPageData(doc, url, html) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const og = (p) => {
      var _a2, _b2;
      return (_b2 = (_a2 = doc.querySelector(`meta[property="${p}"]`)) == null ? void 0 : _a2.getAttribute("content")) != null ? _b2 : "";
    };
    const mt = (n) => {
      var _a2, _b2;
      return (_b2 = (_a2 = doc.querySelector(`meta[name="${n}"]`)) == null ? void 0 : _a2.getAttribute("content")) != null ? _b2 : "";
    };
    const title = og("og:title") || ((_b = (_a = doc.querySelector("title")) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim()) || url;
    const description = og("og:description") || mt("description");
    const site = og("og:site_name") || new URL(url).hostname;
    const image = og("og:image");
    let author = (_e = (_d = (_c = doc.querySelector('[rel="author"], .author, [itemprop="author"]')) == null ? void 0 : _c.textContent) == null ? void 0 : _d.trim()) != null ? _e : "";
    if (!author) author = mt("author");
    let published = og("article:published_time") || mt("article:published_time");
    if (!published)
      published = (_g = (_f = doc.querySelector("time[datetime]")) == null ? void 0 : _f.getAttribute("datetime")) != null ? _g : "";
    const clone = new DOMParser().parseFromString(html, "text/html");
    [
      "script",
      "style",
      "nav",
      "footer",
      "header",
      "aside",
      "iframe",
      "noscript"
    ].forEach((s) => clone.querySelectorAll(s).forEach((e) => e.remove()));
    const main = clone.querySelector("article") || clone.querySelector("main") || clone.querySelector("[role='main']") || clone.querySelector(".post-content, .article-body, .entry-content") || clone.body;
    const contentHtml = (_i = (_h = main == null ? void 0 : main.innerHTML) == null ? void 0 : _h.trim()) != null ? _i : "";
    const tempData = {
      title,
      url,
      description,
      author,
      site,
      published,
      image,
      content: "",
      contentHtml,
      fullHtml: html,
      reason: "",
      category: ""
    };
    const content = new WCEngine(doc, tempData).toMarkdown(contentHtml);
    return {
      title: title.trim(),
      url,
      description: description.trim(),
      author: author.trim(),
      site,
      published,
      image,
      content,
      contentHtml,
      fullHtml: html,
      reason: "",
      category: ""
    };
  }
  // ── Clip orchestration ───────────────────────────────────────────────────
  // Only called for brand new notes from the share sheet.
  // The file stays exactly where Obsidian put it — we only rewrite the content.
  async checkAndClip(file) {
    var _a, _b, _c, _d, _e;
    if (this.processing.has(file.path)) return;
    const content = await this.app.vault.read(file);
    if (!isRawUrlNote(content)) return;
    const urlMatch = content.trim().match(/https?:\/\/[^\s]+/);
    if (!urlMatch) return;
    const url = urlMatch[0];
    this.processing.add(file.path);
    new import_obsidian.Notice("\u{1F4CE} Share Clipper: fetching\u2026");
    try {
      const fetched = await this.fetchPage(url);
      const doc = (_a = fetched == null ? void 0 : fetched.doc) != null ? _a : new DOMParser().parseFromString("", "text/html");
      const pageData = fetched ? this.extractPageData(doc, url, fetched.html) : this.blockedPageData(url);
      const templates = await this.loadTemplates();
      const auto = templates.find((t) => templateMatchesUrl(t.tpl, url));
      const defName = (_d = (_c = auto == null ? void 0 : auto.name) != null ? _c : (_b = templates.find((t) => t.name === this.settings.defaultTemplate)) == null ? void 0 : _b.name) != null ? _d : templates[0].name;
      const resolvedNames = resolveTemplateNames(templates, doc, pageData);
      const details = await new Promise(
        (res) => new SaveDialog(
          this.app,
          templates,
          defName,
          this.existingCategories(),
          resolvedNames,
          res
        ).open()
      );
      if (!details) {
        new import_obsidian.Notice("Cancelled");
        return;
      }
      const chosen = (_e = templates.find((t) => t.name === details.templateName)) != null ? _e : templates[0];
      const engine = new WCEngine(doc, {
        ...pageData,
        reason: details.reason,
        category: details.category
      });
      const noteContent = buildNote(chosen.tpl, engine);
      await this.app.vault.modify(file, noteContent);
      const targetFolder = details.path;
      const targetName = details.noteName.replace(/[\\/:*?"<>|]/g, "").substring(0, 80).trim() || file.basename;
      const targetPath = targetFolder ? `${targetFolder}/${targetName}.md` : `${targetName}.md`;
      if (targetPath !== file.path) {
        if (targetFolder) await this.ensureFolder(targetFolder);
        await this.app.vault.rename(file, targetPath);
      }
      new import_obsidian.Notice(`\u2705 Clipped: ${targetName}`);
    } catch (err) {
      console.error("Share Clipper:", err);
      await this.app.vault.modify(file, this.errorContent(url, "checkAndClip", err)).catch(() => {
      });
    } finally {
      this.processing.delete(file.path);
    }
  }
  // Called from URI handler or clipboard command — creates a brand new note.
  async clipUrl(url) {
    var _a, _b, _c, _d, _e;
    new import_obsidian.Notice("\u{1F4CE} Share Clipper: fetching\u2026");
    try {
      const fetched = await this.fetchPage(url);
      const doc = (_a = fetched == null ? void 0 : fetched.doc) != null ? _a : new DOMParser().parseFromString("", "text/html");
      const pageData = fetched ? this.extractPageData(doc, url, fetched.html) : this.blockedPageData(url);
      const templates = await this.loadTemplates();
      const auto = templates.find((t) => templateMatchesUrl(t.tpl, url));
      const defName = (_d = (_c = auto == null ? void 0 : auto.name) != null ? _c : (_b = templates.find((t) => t.name === this.settings.defaultTemplate)) == null ? void 0 : _b.name) != null ? _d : templates[0].name;
      const resolvedNames = resolveTemplateNames(templates, doc, pageData);
      const details = await new Promise(
        (res) => new SaveDialog(
          this.app,
          templates,
          defName,
          this.existingCategories(),
          resolvedNames,
          res
        ).open()
      );
      if (!details) {
        new import_obsidian.Notice("Cancelled");
        return;
      }
      const chosen = (_e = templates.find((t) => t.name === details.templateName)) != null ? _e : templates[0];
      const engine = new WCEngine(doc, {
        ...pageData,
        reason: details.reason,
        category: details.category
      });
      const noteContent = buildNote(chosen.tpl, engine);
      const targetFolder = details.path;
      const targetName = details.noteName.replace(/[\\/:*?"<>|]/g, "").substring(0, 80).trim() || "Clipping";
      const path = targetFolder ? `${targetFolder}/${targetName}.md` : `${targetName}.md`;
      if (targetFolder) await this.ensureFolder(targetFolder);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof import_obsidian.TFile)
        await this.app.vault.modify(existing, noteContent);
      else await this.app.vault.create(path, noteContent);
      new import_obsidian.Notice(`\u2705 Clipped: ${targetName}`);
    } catch (err) {
      console.error("Share Clipper:", err);
      try {
        const safeName = `Clipping Error ${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
        await this.app.vault.create(
          `${safeName}.md`,
          this.errorContent(url, "clipUrl", err)
        );
      } catch (e) {
      }
    }
  }
  existingCategories() {
    const cats = /* @__PURE__ */ new Set();
    this.app.vault.getMarkdownFiles().forEach((f) => {
      var _a, _b;
      const cat = (_b = (_a = this.app.metadataCache.getFileCache(f)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b.category;
      if (cat && typeof cat === "string") cats.add(cat.trim());
    });
    return Array.from(cats).sort();
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var ShareClipperSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl: el } = this;
    el.empty();
    el.createEl("h2", { text: "Share Clipper" });
    el.createEl("h3", { text: "Templates" });
    new import_obsidian.Setting(el).setName("Templates folder").setDesc(
      "Vault folder containing your Web Clipper template notes. Each note's content is the template JSON."
    ).addText(
      (t) => t.setPlaceholder("templates/web-clipper").setValue(this.plugin.settings.templateFolder).onChange(async (v) => {
        this.plugin.settings.templateFolder = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(el).setName("Default template").setDesc(
      "Template to pre-select when no URL trigger matches. Use the `name` field from the JSON."
    ).addText(
      (t) => t.setPlaceholder("Default").setValue(this.plugin.settings.defaultTemplate).onChange(async (v) => {
        this.plugin.settings.defaultTemplate = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(el).setName("Template builder").setDesc(
      "Create and edit templates using the official Web Clipper JSON schema."
    ).addButton(
      (b) => b.setButtonText("Open template builder").onClick(
        () => new TemplateBuilderModal(this.app, this.plugin).open()
      )
    );
    el.createEl("h3", { text: "Advanced" });
    new import_obsidian.Setting(el).setName("Detection delay (ms)").setDesc(
      "How long to wait after a note is created before checking for a shared URL. Default: 1500."
    ).addText(
      (t) => t.setValue(String(this.plugin.settings.watchDelay)).onChange(async (v) => {
        const n = parseInt(v);
        if (!isNaN(n)) {
          this.plugin.settings.watchDelay = n;
          await this.plugin.saveSettings();
        }
      })
    );
    el.createEl("h3", { text: "How it works" });
    el.createEl("p", {
      text: "Share any page from your browser to Obsidian. The plugin detects the new note, fetches the page, shows a quick dialog for template/reason/category, and rewrites the note using your chosen template. The file stays wherever Obsidian put it.",
      cls: "setting-item-description"
    });
    el.createEl("p", {
      text: "Templates are standard Obsidian Web Clipper JSON \u2014 community templates work without modification. Paste the JSON into a note in your templates folder.",
      cls: "setting-item-description"
    });
    el.createEl("p", {
      text: "If a site blocks fetching, the note will contain a warning callout with the URL preserved. Not available (browser-only): {{highlights}}, {{selection}}, {{prompt:}} (AI).",
      cls: "setting-item-description"
    });
  }
};
