import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	requestUrl,
} from "obsidian";

// ═══════════════════════════════════════════════════════════════════════════════
// WEB CLIPPER TEMPLATE SCHEMA
// Templates are vault notes whose content is Web Clipper JSON.
// ═══════════════════════════════════════════════════════════════════════════════

interface WCProperty {
	name:  string;
	value: string;
	type:  "text" | "multitext" | "number" | "checkbox" | "date" | "datetime" | "tags";
}

interface WCTemplate {
	schemaVersion?:    string;
	name:              string;
	behavior?:         "create" | "append" | "prepend" | "overwrite";
	noteNameFormat?:   string;
	path?:             string;
	noteContentFormat: string;
	context?:          string;
	properties:        WCProperty[];
	triggers:          string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE DATA
// ═══════════════════════════════════════════════════════════════════════════════

interface PageData {
	title:       string;
	url:         string;
	description: string;
	author:      string;
	site:        string;
	published:   string;
	image:       string;
	content:     string;
	contentHtml: string;
	fullHtml:    string;
	reason:      string;
	category:    string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

interface ShareClipperSettings {
	templateFolder:  string;
	defaultTemplate: string;
	watchDelay:      number;
}

const DEFAULT_SETTINGS: ShareClipperSettings = {
	templateFolder:  "Templates/Web Clipper",
	defaultTemplate: "Default",
	watchDelay:      1500,
};

const DEFAULT_TEMPLATE_JSON = `{
  "schemaVersion": "0.1.0",
  "name": "Default",
  "behavior": "create",
  "noteNameFormat": "{{title|safe_name}}",
  "path": "Clippings",
  "noteContentFormat": "{{content}}",
  "properties": [
    { "name": "title",       "value": "{{title}}",       "type": "text" },
    { "name": "url",         "value": "{{url}}",         "type": "text" },
    { "name": "author",      "value": "{{author}}",      "type": "text" },
    { "name": "site",        "value": "{{site}}",        "type": "text" },
    { "name": "published",   "value": "{{published}}",   "type": "date" },
    { "name": "description", "value": "{{description}}", "type": "text" },
    { "name": "clipped",     "value": "{{date}}",        "type": "date" },
    { "name": "tags",        "value": "clipping",        "type": "multitext" },
    { "name": "reason",      "value": "{{reason}}",      "type": "text" },
    { "name": "category",    "value": "{{category}}",    "type": "text" }
  ],
  "triggers": []
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// WEB CLIPPER VARIABLE & FILTER ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

class WCEngine {
	private doc:    Document;
	private data:   PageData;
	private jsonLd: Record<string, unknown>[];

	constructor(doc: Document, data: PageData) {
		this.doc    = doc;
		this.data   = data;
		this.jsonLd = this.extractJsonLd(doc);
	}

	private extractJsonLd(doc: Document): Record<string, unknown>[] {
		const out: Record<string, unknown>[] = [];
		doc.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
			try {
				const p = JSON.parse(el.textContent ?? "");
				if (p?.["@graph"] && Array.isArray(p["@graph"])) out.push(...p["@graph"]);
				else if (Array.isArray(p)) out.push(...p);
				else out.push(p);
			} catch { /* ignore malformed JSON-LD */ }
		});
		return out;
	}

	resolve(template: string): string {
		return template.replace(/\{\{([\s\S]+?)\}\}/g, (_, expr) => {
			try {
				const v = this.resolveExpr(expr.trim());
				return Array.isArray(v) ? v.join(", ") : String(v);
			} catch { return ""; }
		});
	}

	private resolveExpr(expr: string): string | string[] {
		const parts = this.splitPipe(expr);
		let val: string | string[] = this.resolveVar(parts[0].trim());
		for (const f of parts.slice(1)) val = this.applyFilter(val, f.trim());
		return val;
	}

	private resolveVar(name: string): string | string[] {
		if (name.startsWith("selector:"))     return this.doSelector(name.slice(9),  false);
		if (name.startsWith("selectorHtml:")) return this.doSelector(name.slice(13), true);
		if (name.startsWith("schema:"))       return this.doSchema(name.slice(7));
		if (name.startsWith("meta:"))         return this.doMeta(name.slice(5));

		switch (name) {
			case "title":         return this.data.title;
			case "url":           return this.data.url;
			case "description":   return this.data.description;
			case "author":        return this.data.author;
			case "site":          return this.data.site;
			case "published":     return this.data.published;
			case "image":         return this.data.image;
			case "content":
			case "context":       return this.data.content;
			case "contentHtml":   return this.data.contentHtml;
			case "fullHtml":      return this.data.fullHtml;
			case "date":          return new Date().toISOString().split("T")[0];
			case "time":          return new Date().toISOString();
			case "highlights":
			case "selection":
			case "selectionHtml": return "";
			case "reason":        return this.data.reason;
			case "category":      return this.data.category;
			default:              return "";
		}
	}

	private doSelector(expr: string, asHtml: boolean): string[] {
		const qi = expr.lastIndexOf("?");
		let css = expr, attr = "";
		if (qi > 0) { css = expr.slice(0, qi); attr = expr.slice(qi + 1); }
		const els = Array.from(this.doc.querySelectorAll(css));
		return els.map(el => {
			if (attr)   return el.getAttribute(attr) ?? "";
			if (asHtml) return el.innerHTML.trim();
			return el.textContent?.trim() ?? "";
		});
	}

	private doSchema(path: string): string | string[] {
		let type = "", keyPath = path;
		if (path.startsWith("@")) {
			const ci = path.indexOf(":");
			if (ci !== -1) { type = path.slice(1, ci); keyPath = path.slice(ci + 1); }
			else            { type = path.slice(1);     keyPath = ""; }
		}
		const schemas = type
			? this.jsonLd.filter(s => { const t = s["@type"]; return t === type || (Array.isArray(t) && t.includes(type)); })
			: this.jsonLd;
		for (const s of schemas) {
			const v = this.deepGet(s, keyPath);
			if (v != null) return Array.isArray(v) ? v.map(x => this.schemaStr(x)) : this.schemaStr(v);
		}
		return "";
	}

	private deepGet(obj: unknown, path: string): unknown {
		if (!path) return obj;
		let cur: unknown = obj;
		for (const part of path.split(".")) {
			const m = part.match(/^(.+?)\[(\d+|\*)\]$/);
			if (m) {
				cur = (cur as Record<string, unknown>)?.[m[1]];
				if (!Array.isArray(cur)) return undefined;
				cur = m[2] === "*" ? cur : cur[parseInt(m[2])];
			} else {
				cur = (cur as Record<string, unknown>)?.[part];
			}
			if (cur == null) return undefined;
		}
		return cur;
	}

	private schemaStr(v: unknown): string {
		if (typeof v === "string" || typeof v === "number") return String(v);
		if (typeof v === "object" && v !== null) {
			const o = v as Record<string, unknown>;
			if (o.name)      return String(o.name);
			if (o["@value"]) return String(o["@value"]);
		}
		return JSON.stringify(v);
	}

	private doMeta(name: string): string {
		return (
			this.doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ||
			this.doc.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ||
			""
		);
	}

	private applyFilter(val: string | string[], f: string): string | string[] {
		const ci   = f.indexOf(":");
		const name = ci === -1 ? f : f.slice(0, ci);
		const arg  = ci === -1 ? "" : f.slice(ci + 1).trim();

		if (Array.isArray(val)) {
			switch (name) {
				case "join":       return val.join(this.strArg(arg) ?? "");
				case "first":      return val[0] ?? "";
				case "slice":      return this.sliceArr(val, arg);
				case "wikilink":   return val.map(v => this.mkWikilink(v, arg));
				case "markdown":   return val.map(v => this.toMarkdown(v));
				case "trim":       return val.map(v => v.trim());
				case "lower":      return val.map(v => v.toLowerCase());
				case "upper":      return val.map(v => v.toUpperCase());
				case "replace":    return val.map(v => this.doReplace(v, arg));
				case "unique":     return [...new Set(val)];
				case "link":       return val.map(v => `[${this.strArg(arg) || v}](${v})`);
				case "blockquote": return val.map(v => v.split("\n").map(l => "> " + l).join("\n"));
				case "list":       return val.map(v => `- ${v}`).join("\n");
				case "strip_tags": return val.map(v => v.replace(/<[^>]+>/g, ""));
				default: {
					const mapped = val.map(v => this.applyFilter(v, f));
					return mapped.flat() as string[];
				}
			}
		}

		switch (name) {
			case "date":       return this.formatDate(val, arg);
			case "safe_name":  return val.replace(/[\\/\s:*?"<>|#^[\]]/g, c => c.match(/\s/) ? " " : "").replace(/\s+/g, " ").trim();
			case "trim":       return val.trim();
			case "lower":      return val.toLowerCase();
			case "upper":      return val.toUpperCase();
			case "capitalize": return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
			case "title":      return val.replace(/\b\w/g, c => c.toUpperCase());
			case "uncamel":    return val.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase();
			case "markdown":   return this.toMarkdown(val);
			case "strip_tags": return val.replace(/<[^>]+>/g, "");
			case "strip_attr": return val.replace(/<(\w[\w-]*)(\s[^>]*)>/g, "<$1>");
			case "wikilink":   return this.mkWikilink(val, arg);
			case "split":      return val.split(this.strArg(arg) ?? "");
			case "slice":      return this.sliceStr(val, arg);
			case "replace":    return this.doReplace(val, arg);
			case "join":       return val;
			case "first":      return val;
			case "unique":     return val;
			case "blockquote": return val.split("\n").map(l => "> " + l).join("\n");
			case "callout":    return this.mkCallout(val, arg);
			case "link":       return `[${this.strArg(arg) || val}](${val})`;
			case "list":       return `- ${val}`;
			default:           return val;
		}
	}

	private mkWikilink(val: string, arg: string): string {
		const alias = this.strArg(arg);
		return alias ? `[[${val}|${alias}]]` : `[[${val}]]`;
	}

	private formatDate(val: string, arg: string): string {
		const fmt = this.strArg(arg) || "YYYY-MM-DD";
		const d   = val ? new Date(val) : new Date();
		if (isNaN(d.getTime())) return val;
		return fmt
			.replace("YYYY", String(d.getFullYear()))
			.replace("MM",   String(d.getMonth() + 1).padStart(2, "0"))
			.replace("DD",   String(d.getDate()).padStart(2, "0"))
			.replace("HH",   String(d.getHours()).padStart(2, "0"))
			.replace("mm",   String(d.getMinutes()).padStart(2, "0"))
			.replace("ss",   String(d.getSeconds()).padStart(2, "0"));
	}

	private sliceStr(val: string, arg: string): string {
		const [a, b] = arg.split(",").map(n => parseInt(n.trim()));
		return isNaN(b) ? val.slice(a) : val.slice(a, b);
	}

	private sliceArr(val: string[], arg: string): string[] {
		const [a, b] = arg.split(",").map(n => parseInt(n.trim()));
		return isNaN(b) ? val.slice(a) : val.slice(a, b);
	}

	private doReplace(val: string, arg: string): string {
		arg = arg.trim();
		if (arg.startsWith("(")) {
			const inner = arg.slice(1, arg.lastIndexOf(")"));
			for (const [from, to] of this.parsePairs(inner)) val = this.replaceOne(val, from, to);
			return val;
		}
		const parts = this.parseQuotedPair(arg);
		return parts.length >= 2 ? this.replaceOne(val, parts[0], parts[1]) : val;
	}

	private replaceOne(val: string, from: string, to: string): string {
		const m = from.match(/^\/(.+)\/([gimsuy]*)$/);
		if (m) {
			try { return val.replace(new RegExp(m[1], m[2] || "g"), to); }
			catch { return val; }
		}
		return val.split(from).join(to);
	}

	private parsePairs(inner: string): [string, string][] {
		const pairs: [string, string][] = [];
		const re = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(inner)) !== null) pairs.push([this.unescape(m[1]), this.unescape(m[2])]);
		return pairs;
	}

	private parseQuotedPair(arg: string): string[] {
		const result: string[] = [];
		let i = 0;
		while (i < arg.length) {
			if (arg[i] === '"') {
				let s = ""; i++;
				while (i < arg.length && arg[i] !== '"') {
					s += arg[i] === "\\" && i + 1 < arg.length ? arg[++i] : arg[i];
					i++;
				}
				i++;
				result.push(s);
				while (i < arg.length && (arg[i] === ":" || arg[i] === " ")) i++;
			} else { i++; }
		}
		return result;
	}

	private strArg(arg: string): string {
		arg = arg.trim();
		if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'")))
			return this.unescape(arg.slice(1, -1));
		return arg;
	}

	private unescape(s: string): string {
		return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}

	private mkCallout(val: string, arg: string): string {
		const m     = arg.match(/\(\s*"([^"]*)"\s*(?:,\s*"([^"]*)"\s*)?(?:,\s*(true|false|null)\s*)?\)/);
		const type  = m?.[1] ?? "info";
		const title = m?.[2] ?? "";
		const fold  = m?.[3] === "true" ? "+" : m?.[3] === "false" ? "-" : "";
		return `> [!${type}]${fold}${title ? " " + title : ""}\n${val.split("\n").map(l => "> " + l).join("\n")}`;
	}

	toMarkdown(html: string): string {
		const d = new DOMParser().parseFromString(html, "text/html");
		["script","style","svg","noscript"].forEach(t => d.querySelectorAll(t).forEach(e => e.remove()));
		return this.walkNode(d.body).replace(/\n{3,}/g, "\n\n").trim();
	}

	private walkNode(node: Node): string {
		if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\s+/g, " ") || "";
		if (node.nodeType !== Node.ELEMENT_NODE) return "";
		const el  = node as Element;
		const tag = el.tagName.toLowerCase();
		if (["script","style","svg","noscript"].includes(tag)) return "";
		const kids = Array.from(node.childNodes).map(c => this.walkNode(c)).join("");
		switch (tag) {
			case "h1": return `\n# ${kids.trim()}\n`;
			case "h2": return `\n## ${kids.trim()}\n`;
			case "h3": return `\n### ${kids.trim()}\n`;
			case "h4": return `\n#### ${kids.trim()}\n`;
			case "h5": return `\n##### ${kids.trim()}\n`;
			case "h6": return `\n###### ${kids.trim()}\n`;
			case "p":  return `\n${kids.trim()}\n`;
			case "br": return "\n";
			case "strong": case "b":   return `**${kids}**`;
			case "em":     case "i":   return `*${kids}*`;
			case "s":      case "del": return `~~${kids}~~`;
			case "a":  { const h = el.getAttribute("href"); return h ? `[${kids}](${h})` : kids; }
			case "img":{ const s = el.getAttribute("src")||""; const a = el.getAttribute("alt")||""; return s ? `![${a}](${s})` : ""; }
			case "ul": case "ol": return `\n${kids}\n`;
			case "li": return `\n- ${kids.trim()}`;
			case "blockquote": return `\n> ${kids.trim()}\n`;
			case "code": return el.closest("pre") ? kids : `\`${kids}\``;
			case "pre":  return `\n\`\`\`\n${el.textContent?.trim()}\n\`\`\`\n`;
			case "hr":   return "\n---\n";
			case "table":return `\n${kids}\n`;
			case "thead": case "tbody": case "tr": return kids;
			case "th": return `| ${kids.trim()} `;
			case "td": return `| ${kids.trim()} `;
			default: return kids;
		}
	}

	private splitPipe(expr: string): string[] {
		const parts: string[] = [];
		let cur = "", depth = 0, inStr = false, sc = "";
		for (let i = 0; i < expr.length; i++) {
			const ch = expr[i];
			if (inStr) {
				cur += ch;
				if (ch === sc && expr[i - 1] !== "\\") inStr = false;
			} else if (ch === '"' || ch === "'") { inStr = true; sc = ch; cur += ch; }
			else if (ch === "(")                  { depth++; cur += ch; }
			else if (ch === ")")                  { depth--; cur += ch; }
			else if (ch === "|" && depth === 0)   { parts.push(cur); cur = ""; }
			else                                  { cur += ch; }
		}
		if (cur) parts.push(cur);
		return parts;
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// YAML FRONTMATTER BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildFrontmatter(properties: WCProperty[], engine: WCEngine): string {
	const lines = ["---"];
	for (const prop of properties) {
		const raw = engine.resolve(prop.value);
		lines.push(yamlLine(prop.name, raw, prop.type));
	}
	lines.push("---");
	return lines.join("\n");
}

function yamlLine(name: string, value: string | string[], type: string): string {
	if (type === "multitext" || type === "tags") {
		const arr = (Array.isArray(value) ? value : [value]).filter(Boolean);
		if (arr.length === 0) return `${name}:`;
		return `${name}:\n` + arr.map(v => `  - ${yamlScalar(v)}`).join("\n");
	}
	if (type === "checkbox") return `${name}: ${value === "true" || value === "1"}`;
	if (type === "number")   return `${name}: ${parseFloat(String(value)) || 0}`;
	const str = Array.isArray(value) ? value.join(", ") : String(value);
	if (!str) return `${name}:`;
	return `${name}: ${yamlScalar(str)}`;
}

function yamlScalar(v: string): string {
	if (/[:#\[\]{},|>&*!'"@`\n]/.test(v) || v.trim() !== v)
		return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	return v;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseTemplateNote(content: string): WCTemplate | null {
	let json = content.trim();
	const fence = json.match(/^```(?:json)?\s*\n([\s\S]+?)\n```\s*$/);
	if (fence) json = fence[1].trim();
	try { return JSON.parse(json) as WCTemplate; }
	catch { return null; }
}

function templateMatchesUrl(tpl: WCTemplate, url: string): boolean {
	for (const trigger of (tpl.triggers ?? [])) {
		if (!trigger || trigger.startsWith("schema:")) continue;
		if (trigger.startsWith("/") && trigger.lastIndexOf("/") > 0) {
			const last = trigger.lastIndexOf("/");
			try { if (new RegExp(trigger.slice(1, last), trigger.slice(last + 1)).test(url)) return true; }
			catch { /* ignore */ }
		} else {
			if (url.startsWith(trigger) || url.includes(trigger)) return true;
		}
	}
	return false;
}

function buildNote(tpl: WCTemplate, engine: WCEngine): string {
	const fm  = buildFrontmatter(tpl.properties ?? [], engine);
	let body  = tpl.noteContentFormat ?? "{{content}}";
	if (tpl.context) {
		const ctx = engine.resolve(tpl.context);
		body = body.replace(/\{\{context\}\}/g, ctx);
	}
	const bodyResolved = engine.resolve(body).replace(/\\n/g, "\n");
	return `${fm}\n\n${bodyResolved}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED STYLES
// ═══════════════════════════════════════════════════════════════════════════════

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
		.sc-label {
			display:block; font-size:.82em; font-weight:600;
			text-transform:uppercase; letter-spacing:.05em;
			color:var(--text-muted); margin:14px 0 4px;
		}
		.sc-label:first-child { margin-top:0; }
		.sc-input {
			width:100%; padding:6px 10px; border-radius:6px;
			border:1px solid var(--background-modifier-border);
			background:var(--background-primary); color:var(--text-normal);
			font-size:1em; box-sizing:border-box;
		}
		.sc-select {
			width:100%; padding:6px 10px; border-radius:6px;
			border:1px solid var(--background-modifier-border);
			background:var(--background-primary); color:var(--text-normal);
			font-size:1em; box-sizing:border-box; cursor:pointer;
		}
		.sc-textarea {
			width:100%; padding:8px 10px; border-radius:6px;
			border:1px solid var(--background-modifier-border);
			background:var(--background-primary); color:var(--text-normal);
			font-size:.88em; resize:vertical; box-sizing:border-box;
			font-family:var(--font-monospace); line-height:1.55; flex:1;
		}
		.sc-chips-label { font-size:.8em; color:var(--text-muted); margin:6px 0 4px; }
		.sc-chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
		.sc-chip {
			padding:4px 12px; border-radius:999px;
			border:1px solid var(--background-modifier-border);
			background:var(--background-secondary); color:var(--text-normal);
			cursor:pointer; font-size:.88em; transition:all .12s;
		}
		.sc-chip:hover { background:var(--background-modifier-hover); }
		.sc-chip-selected {
			background:var(--interactive-accent) !important;
			color:var(--text-on-accent) !important;
			border-color:var(--interactive-accent) !important;
		}
		.sc-tpl-item {
			padding:7px 10px; border-radius:6px; cursor:pointer;
			border:1px solid transparent; font-size:.9em;
			background:var(--background-secondary);
			display:flex; justify-content:space-between; align-items:center;
		}
		.sc-tpl-item:hover  { background:var(--background-modifier-hover); }
		.sc-tpl-item.active { background:var(--interactive-accent); color:var(--text-on-accent); }
		.sc-tpl-del {
			background:none; border:none; cursor:pointer;
			color:var(--text-muted); font-size:1em; padding:0 2px; opacity:.6;
		}
		.sc-tpl-del:hover { opacity:1; color:var(--text-error); }
		.sc-tpl-item.active .sc-tpl-del { color:var(--text-on-accent); }
		.sc-var-row { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; }
		.sc-var-pill {
			padding:2px 7px; border-radius:4px; font-size:.75em;
			background:var(--background-secondary);
			border:1px solid var(--background-modifier-border);
			cursor:pointer; font-family:var(--font-monospace); color:var(--text-accent);
		}
		.sc-var-pill:hover { background:var(--background-modifier-hover); }
		.sc-btn-row { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }
		.sc-btn-spread { display:flex; justify-content:space-between; gap:8px; margin-top:16px; }
		.sc-btn {
			padding:7px 16px; border-radius:6px; cursor:pointer;
			border:1px solid var(--background-modifier-border);
			background:var(--background-secondary); color:var(--text-normal); font-size:.9em;
		}
		.sc-btn:hover { background:var(--background-modifier-hover); }
		.sc-btn-accent {
			padding:7px 18px; border-radius:6px; border:none; cursor:pointer;
			background:var(--interactive-accent); color:var(--text-on-accent);
			font-weight:600; font-size:.9em;
		}
		.sc-btn-accent:hover { filter:brightness(1.1); }
		.sc-btn-danger {
			padding:7px 14px; border-radius:6px; border:none; cursor:pointer;
			background:var(--background-modifier-error); color:var(--text-error); font-size:.9em;
		}
		.sc-divider { border:none; border-top:1px solid var(--background-modifier-border); margin:10px 0; }
		.sc-hint { font-size:.8em; color:var(--text-muted); margin:4px 0 0; }
		.sc-status { font-size:.8em; color:var(--color-green); }
	`;
	document.head.appendChild(s);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAVE DIALOG
// Obsidian already asked for the filename. We just need:
//   - Which template (if > 1 exists, auto-selected by trigger)
//   - Why are you saving this
//   - Category
// ═══════════════════════════════════════════════════════════════════════════════

interface SaveDetails {
	templateName: string;
	reason:       string;
	category:     string;
}

class SaveDialog extends Modal {
	private resolve:    (d: SaveDetails | null) => void;
	private templates:  { name: string; tpl: WCTemplate }[];
	private autoSelect: string;
	private categories: string[];

	private selName  = "";
	private reasonVal= "";
	private catVal   = "";

	constructor(
		app: App,
		templates:  { name: string; tpl: WCTemplate }[],
		autoSelect: string,
		categories: string[],
		resolve:    (d: SaveDetails | null) => void,
	) {
		super(app);
		this.templates  = templates;
		this.autoSelect = autoSelect;
		this.categories = categories;
		this.resolve    = resolve;
		this.selName    = autoSelect || templates[0]?.name || "";
	}

	onOpen() {
		injectStyles();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("sc-modal");
		contentEl.createEl("h2", { text: "Save Clipping" });

		// Template selector — only shown when more than one template exists
		if (this.templates.length > 1) {
			contentEl.createEl("label", { text: "Template", cls: "sc-label" });
			const sel = contentEl.createEl("select", { cls: "sc-select" }) as HTMLSelectElement;
			for (const t of this.templates) {
				const opt = sel.createEl("option", { text: t.name });
				opt.value = t.name;
				if (t.name === this.selName) opt.selected = true;
			}
			sel.addEventListener("change", () => { this.selName = sel.value; });
			if (this.autoSelect) {
				contentEl.createEl("p", {
					text: `↑ Auto-selected by URL trigger`,
					cls: "sc-hint",
				});
			}
		}

		// Reason
		contentEl.createEl("label", { text: "Why are you saving this?", cls: "sc-label" });
		const reasonInput = contentEl.createEl("textarea", { cls: "sc-textarea" });
		reasonInput.placeholder = "Research, writing reference, thriller craft…";
		reasonInput.rows = 3;
		reasonInput.style.minHeight = "unset";
		reasonInput.addEventListener("input", () => { this.reasonVal = reasonInput.value; });

		// Category chips + new
		contentEl.createEl("label", { text: "Category", cls: "sc-label" });
		const catWrap = contentEl.createDiv();

		if (this.categories.length > 0) {
			catWrap.createEl("p", { text: "Existing:", cls: "sc-chips-label" });
			const chips = catWrap.createDiv({ cls: "sc-chips" });
			for (const cat of this.categories) {
				const chip = chips.createEl("button", { text: cat, cls: "sc-chip" });
				chip.addEventListener("click", () => {
					chips.querySelectorAll(".sc-chip").forEach(c => c.removeClass("sc-chip-selected"));
					chip.addClass("sc-chip-selected");
					this.catVal = cat;
					newCat.value = "";
				});
			}
		}

		catWrap.createEl("p", {
			text: this.categories.length ? "Or new:" : "Category:",
			cls: "sc-chips-label",
		});
		const newCat = catWrap.createEl("input", { type: "text", cls: "sc-input" });
		newCat.placeholder = "Writing Craft, Research, Tools…";
		newCat.addEventListener("input", () => {
			if (newCat.value) {
				catWrap.querySelectorAll(".sc-chip").forEach(c => c.removeClass("sc-chip-selected"));
				this.catVal = newCat.value;
			}
		});

		// Buttons
		const btnRow = contentEl.createDiv({ cls: "sc-btn-row" });
		btnRow.createEl("button", { text: "Cancel", cls: "sc-btn" })
			.addEventListener("click", () => { this.resolve(null); this.close(); });
		btnRow.createEl("button", { text: "Save", cls: "sc-btn-accent" })
			.addEventListener("click", () => this.submit());

		newCat.addEventListener("keydown", e => { if (e.key === "Enter") this.submit(); });

		// Auto-focus reason since template is auto-selected and there's no title
		setTimeout(() => reasonInput.focus(), 50);
	}

	private submit() {
		this.resolve({
			templateName: this.selName,
			reason:       this.reasonVal.trim(),
			category:     this.catVal.trim(),
		});
		this.close();
	}

	onClose() { this.contentEl.empty(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE BUILDER MODAL
// ═══════════════════════════════════════════════════════════════════════════════

const VARIABLE_REFERENCE = [
	{ token: "{{title}}",              desc: "Page title" },
	{ token: "{{url}}",                desc: "Page URL" },
	{ token: "{{description}}",        desc: "Meta description" },
	{ token: "{{author}}",             desc: "Author" },
	{ token: "{{site}}",               desc: "Site name" },
	{ token: "{{published}}",          desc: "Publish date" },
	{ token: "{{image}}",              desc: "OG image URL" },
	{ token: "{{content}}",            desc: "Article body (markdown)" },
	{ token: "{{contentHtml}}",        desc: "Article body (HTML)" },
	{ token: "{{date}}",               desc: "Today YYYY-MM-DD" },
	{ token: "{{time}}",               desc: "Current ISO timestamp" },
	{ token: "{{reason}}",             desc: "Why saved (plugin extra)" },
	{ token: "{{category}}",           desc: "Category (plugin extra)" },
	{ token: "{{selector:.class}}",    desc: "CSS selector → text" },
	{ token: "{{selectorHtml:article}}", desc: "CSS selector → HTML" },
	{ token: "{{schema:@Type:key}}",   desc: "JSON-LD schema" },
	{ token: "{{meta:name}}",          desc: "Meta tag by name" },
];

const FILTER_REFERENCE = [
	'date:"YYYY-MM-DD"', "safe_name", "trim", "lower", "upper",
	"capitalize", "title", "markdown", "strip_tags", "wikilink",
	'split:", "', 'join:", "', "slice:0,8000",
	'replace:"from":"to"', "first", "blockquote", "unique", "link",
];

class TemplateBuilderModal extends Modal {
	private plugin:   ShareClipperPlugin;
	private notes   = new Map<string, string>();
	private selected = "";
	private isDirty  = false;

	private sidebarEl!:  HTMLElement;
	private editorEl!:   HTMLElement;
	private jsonEl!:     HTMLTextAreaElement;
	private statusEl!:   HTMLElement;

	constructor(app: App, plugin: ShareClipperPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		injectStyles();
		this.modalEl.style.width  = "min(900px, 96vw)";
		this.modalEl.style.height = "min(680px, 92vh)";

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("sc-modal");
		contentEl.style.cssText = "display:flex; flex-direction:column; height:100%;";

		// Header
		const hdr = contentEl.createDiv({ cls: "sc-btn-spread" });
		hdr.style.cssText = "align-items:center; margin-top:0;";
		hdr.createEl("h2", { text: "Template Builder" }).style.margin = "0";
		hdr.createEl("button", { text: "+ New Template", cls: "sc-btn-accent" })
			.addEventListener("click", () => this.newTemplate());

		contentEl.createEl("p", {
			text: `Folder: ${this.plugin.settings.templateFolder}  ·  Each note's content is Web Clipper JSON`,
			cls: "sc-hint",
		});
		contentEl.createEl("hr", { cls: "sc-divider" });

		// Two-col
		const cols = contentEl.createDiv({ cls: "sc-two-col" });
		cols.style.cssText = "flex:1; overflow:hidden;";
		this.sidebarEl = cols.createDiv({ cls: "sc-sidebar" });
		this.editorEl  = cols.createDiv({ cls: "sc-main" });
		this.editorEl.style.overflow = "hidden";

		// Variable pills
		this.editorEl.createEl("label", { text: "Variables — click to copy", cls: "sc-label" }).style.marginTop = "0";
		const varRow = this.editorEl.createDiv({ cls: "sc-var-row" });
		for (const v of VARIABLE_REFERENCE) {
			const pill = varRow.createEl("button", { text: v.token, cls: "sc-var-pill" });
			pill.title = v.desc;
			pill.addEventListener("click", () => { navigator.clipboard.writeText(v.token); new Notice(`Copied ${v.token}`); });
		}

		// Filter pills
		this.editorEl.createEl("label", { text: "Common filters", cls: "sc-label" });
		const filterRow = this.editorEl.createDiv({ cls: "sc-var-row" });
		for (const f of FILTER_REFERENCE) {
			const pill = filterRow.createEl("button", { text: f, cls: "sc-var-pill" });
			pill.style.color = "var(--text-muted)";
			pill.addEventListener("click", () => { navigator.clipboard.writeText(f); new Notice(`Copied ${f}`); });
		}

		// JSON editor
		this.editorEl.createEl("label", { text: "Template JSON", cls: "sc-label" });
		this.jsonEl = this.editorEl.createEl("textarea", { cls: "sc-textarea" });
		this.jsonEl.style.cssText = "flex:1; min-height:180px;";
		this.jsonEl.addEventListener("input", () => { this.isDirty = true; });

		// Bottom bar
		const bRow = this.editorEl.createDiv({ cls: "sc-btn-spread" });
		bRow.style.marginTop = "8px";
		this.statusEl = bRow.createEl("span", { cls: "sc-status" });
		const rBtns = bRow.createDiv({ cls: "sc-btn-row" });
		rBtns.style.marginTop = "0";
		rBtns.createEl("button", { text: "Delete", cls: "sc-btn-danger" })
			.addEventListener("click", () => this.deleteTemplate());
		rBtns.createEl("button", { text: "Save", cls: "sc-btn-accent" })
			.addEventListener("click", () => this.saveTemplate());

		await this.loadNotes();
		this.renderSidebar();
		const first = Array.from(this.notes.keys())[0];
		if (first) this.selectNote(first);
		else this.editorEl.style.opacity = "0.5";
	}

	private async loadNotes() {
		this.notes.clear();
		await this.plugin.ensureFolder(this.plugin.settings.templateFolder);
		const folder = this.app.vault.getAbstractFileByPath(this.plugin.settings.templateFolder);
		if (!(folder instanceof TFolder)) return;
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md")
				this.notes.set(child.basename, await this.app.vault.read(child));
		}
	}

	private renderSidebar() {
		this.sidebarEl.empty();
		if (this.notes.size === 0) {
			this.sidebarEl.createEl("p", { text: "No templates yet.", cls: "sc-hint" });
			return;
		}
		for (const name of this.notes.keys()) {
			const item = this.sidebarEl.createDiv({
				cls: "sc-tpl-item" + (name === this.selected ? " active" : ""),
			});
			item.createEl("span", { text: name });
			const del = item.createEl("button", { text: "✕", cls: "sc-tpl-del" });
			del.title = "Delete";
			del.addEventListener("click", async e => {
				e.stopPropagation();
				this.selected = name;
				await this.deleteTemplate();
			});
			item.addEventListener("click", () => {
				if (this.isDirty && this.selected !== name &&
					!confirm(`Discard unsaved changes to "${this.selected}"?`)) return;
				this.selectNote(name);
			});
		}
	}

	private selectNote(name: string) {
		this.selected             = name;
		this.jsonEl.value         = this.notes.get(name) ?? "";
		this.editorEl.style.opacity = "1";
		this.isDirty              = false;
		this.statusEl.textContent = "";
		this.renderSidebar();
	}

	private newTemplate() {
		const name = `New Template ${this.notes.size + 1}`;
		this.notes.set(name, DEFAULT_TEMPLATE_JSON.replace('"Default"', `"${name}"`));
		this.renderSidebar();
		this.selectNote(name);
		this.isDirty = true;
	}

	private async saveTemplate() {
		const json = this.jsonEl.value.trim();
		if (!json) { new Notice("Template is empty"); return; }
		try { JSON.parse(json); } catch (e) { new Notice(`Invalid JSON: ${(e as Error).message}`); return; }

		// Use the `name` field inside the JSON as the filename
		let saveName = this.selected;
		try { const p = JSON.parse(json) as WCTemplate; if (p.name) saveName = p.name; } catch {}

		const folder  = this.plugin.settings.templateFolder;
		const oldPath = `${folder}/${this.selected}.md`;
		const newPath = `${folder}/${saveName}.md`;

		if (this.selected !== saveName) {
			const old = this.app.vault.getAbstractFileByPath(oldPath);
			if (old instanceof TFile) await this.app.vault.delete(old);
			this.notes.delete(this.selected);
		}

		const existing = this.app.vault.getAbstractFileByPath(newPath);
		if (existing instanceof TFile) await this.app.vault.modify(existing, json);
		else await this.app.vault.create(newPath, json);

		this.notes.set(saveName, json);
		this.selected             = saveName;
		this.isDirty              = false;
		this.statusEl.textContent = "✓ Saved";
		setTimeout(() => { this.statusEl.textContent = ""; }, 2000);
		this.renderSidebar();
	}

	private async deleteTemplate() {
		if (!this.selected || !confirm(`Delete template "${this.selected}"?`)) return;
		const path = `${this.plugin.settings.templateFolder}/${this.selected}.md`;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await this.app.vault.delete(file);
		this.notes.delete(this.selected);
		this.selected = "";
		const remaining = Array.from(this.notes.keys());
		if (remaining.length) this.selectNote(remaining[0]);
		else { this.jsonEl.value = ""; this.editorEl.style.opacity = "0.5"; }
		this.renderSidebar();
		new Notice("Template deleted");
	}

	onClose() { this.contentEl.empty(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

const URL_PATTERN = /^https?:\/\/[^\s]+$/m;

// A note is considered "unprocessed" if its content is still just a raw URL —
// i.e. the plugin hasn't run the template engine on it yet.
function isRawUrlNote(content: string): boolean {
	const t = content.trim();
	return URL_PATTERN.test(t) && t.split("\n").length <= 3;
}

export default class ShareClipperPlugin extends Plugin {
	settings: ShareClipperSettings;
	private processing = new Set<string>();

	async onload() {
		await this.loadSettings();
		await this.ensureDefaultTemplate();

		// ── Cold-start catch ─────────────────────────────────────────────────
		// If Obsidian was closed when the share happened, the note was written
		// before the plugin loaded. onLayoutReady fires once the workspace is
		// fully initialised — scan for any recent bare-URL notes we missed.
		this.app.workspace.onLayoutReady(async () => {
			const fiveMinAgo = Date.now() - 5 * 60 * 1000;
			const candidates = this.app.vault.getMarkdownFiles().filter(
				f => f.stat.ctime > fiveMinAgo
			);
			for (const file of candidates) {
				await this.checkAndClip(file);
			}
		});

		// ── Live watch — Obsidian already open when share happens ────────────
		this.registerEvent(
			this.app.vault.on("create", async file => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				setTimeout(() => this.checkAndClip(file), this.settings.watchDelay);
			})
		);

		// URI handler: obsidian://share-clipper?url=https://...
		this.registerObsidianProtocolHandler("share-clipper", async params => {
			if (!params.url) { new Notice("Share Clipper: no URL"); return; }
			await this.clipUrl(params.url);
		});

		this.addCommand({
			id: "clip-clipboard", name: "Clip URL from clipboard",
			callback: async () => {
				const text  = await navigator.clipboard.readText().catch(() => "");
				const match = text.trim().match(/https?:\/\/[^\s]+/);
				if (!match) { new Notice("No URL in clipboard"); return; }
				await this.clipUrl(match[0]);
			},
		});

		this.addCommand({
			id: "clip-active", name: "Clip URL from active note",
			callback: async () => {
				const f = this.app.workspace.getActiveFile();
				if (f) await this.checkAndClip(f, true);
			},
		});

		this.addCommand({
			id: "template-builder", name: "Open template builder",
			callback: () => new TemplateBuilderModal(this.app, this).open(),
		});

		this.addSettingTab(new ShareClipperSettingTab(this.app, this));
	}

	// ── Template management ──────────────────────────────────────────────────

	private async ensureDefaultTemplate() {
		await this.ensureFolder(this.settings.templateFolder);
		const path = `${this.settings.templateFolder}/Default.md`;
		if (!this.app.vault.getAbstractFileByPath(path))
			await this.app.vault.create(path, DEFAULT_TEMPLATE_JSON);
	}

	async ensureFolder(path: string) {
		if (!path) return;
		let cur = "";
		for (const part of path.split("/")) {
			cur = cur ? `${cur}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(cur))
				await this.app.vault.createFolder(cur);
		}
	}

	private async loadTemplates(): Promise<{ name: string; tpl: WCTemplate }[]> {
		const folder = this.app.vault.getAbstractFileByPath(this.settings.templateFolder);
		if (!(folder instanceof TFolder)) return [];
		const result: { name: string; tpl: WCTemplate }[] = [];
		for (const child of folder.children) {
			if (!(child instanceof TFile) || child.extension !== "md") continue;
			const content = await this.app.vault.read(child);
			const tpl = parseTemplateNote(content);
			if (tpl) result.push({ name: tpl.name || child.basename, tpl });
		}
		return result.sort((a, b) => a.name.localeCompare(b.name));
	}

	// ── Page fetching & data extraction ─────────────────────────────────────

	private async fetchPage(url: string): Promise<{ doc: Document; html: string }> {
		const resp = await requestUrl({ url, headers: { "User-Agent": "Mozilla/5.0" } });
		const html = resp.text;
		return { doc: new DOMParser().parseFromString(html, "text/html"), html };
	}

	private extractPageData(doc: Document, url: string, html: string): PageData {
		const og = (p: string) => doc.querySelector(`meta[property="${p}"]`)?.getAttribute("content") ?? "";
		const mt = (n: string) => doc.querySelector(`meta[name="${n}"]`)?.getAttribute("content") ?? "";

		const title       = og("og:title") || doc.querySelector("title")?.textContent?.trim() || url;
		const description = og("og:description") || mt("description");
		const site        = og("og:site_name") || new URL(url).hostname;
		const image       = og("og:image");

		let author = doc.querySelector('[rel="author"], .author, [itemprop="author"]')?.textContent?.trim() ?? "";
		if (!author) author = mt("author");

		let published = og("article:published_time") || mt("article:published_time");
		if (!published) published = doc.querySelector("time[datetime]")?.getAttribute("datetime") ?? "";

		// Extract main content
		const clone = new DOMParser().parseFromString(html, "text/html");
		["script","style","nav","footer","header","aside","iframe","noscript"]
			.forEach(s => clone.querySelectorAll(s).forEach(e => e.remove()));
		const main =
			clone.querySelector("article") ||
			clone.querySelector("main") ||
			clone.querySelector("[role='main']") ||
			clone.querySelector(".post-content, .article-body, .entry-content") ||
			clone.body;
		const contentHtml = main?.innerHTML?.trim() ?? "";

		// We need a temporary engine just for the markdown conversion
		const tempData: PageData = { title, url, description, author, site, published, image, content: "", contentHtml, fullHtml: html, reason: "", category: "" };
		const tempEngine = new WCEngine(doc, tempData);
		const content    = tempEngine.toMarkdown(contentHtml);

		return { title: title.trim(), url, description: description.trim(), author: author.trim(), site, published, image, content, contentHtml, fullHtml: html, reason: "", category: "" };
	}

	// ── Clip orchestration ───────────────────────────────────────────────────

	// Called for notes that already exist (share to existing note, or cold-start).
	// The file stays exactly where Obsidian put it — we only rewrite the content.
	private async checkAndClip(file: TFile, force = false) {
		if (this.processing.has(file.path)) return;
		const content = await this.app.vault.read(file);
		if (!isRawUrlNote(content) && !force) return;
		const urlMatch = content.trim().match(/https?:\/\/[^\s]+/);
		if (!urlMatch) return;

		this.processing.add(file.path);
		new Notice("📎 Share Clipper: fetching…");

		try {
			const { doc, html }  = await this.fetchPage(urlMatch[0]);
			const pageData       = this.extractPageData(doc, urlMatch[0], html);
			const templates      = await this.loadTemplates();
			if (!templates.length) { new Notice("No templates found — open the template builder first"); return; }

			const auto    = templates.find(t => templateMatchesUrl(t.tpl, urlMatch[0]));
			const defName = auto?.name
				?? templates.find(t => t.name === this.settings.defaultTemplate)?.name
				?? templates[0].name;

			const details = await new Promise<SaveDetails | null>(res =>
				new SaveDialog(this.app, templates, defName, this.existingCategories(), res).open()
			);
			if (!details) { new Notice("Cancelled"); return; }

			const chosen     = templates.find(t => t.name === details.templateName) ?? templates[0];
			const finalData  = { ...pageData, reason: details.reason, category: details.category };
			const engine     = new WCEngine(doc, finalData);
			const noteContent = buildNote(chosen.tpl, engine);

			// Only rewrite content — do NOT rename or move the file
			await this.app.vault.modify(file, noteContent);
			new Notice(`✅ Clipped: ${file.basename}`);
		} catch (err) {
			console.error("Share Clipper:", err);
			new Notice(`❌ ${(err as Error).message}`);
		} finally {
			this.processing.delete(file.path);
		}
	}

	// Called from URI handler or clipboard command — creates a brand new note.
	private async clipUrl(url: string) {
		new Notice("📎 Share Clipper: fetching…");
		try {
			const { doc, html }  = await this.fetchPage(url);
			const pageData       = this.extractPageData(doc, url, html);
			const templates      = await this.loadTemplates();
			if (!templates.length) { new Notice("No templates found"); return; }

			const auto    = templates.find(t => templateMatchesUrl(t.tpl, url));
			const defName = auto?.name
				?? templates.find(t => t.name === this.settings.defaultTemplate)?.name
				?? templates[0].name;

			const details = await new Promise<SaveDetails | null>(res =>
				new SaveDialog(this.app, templates, defName, this.existingCategories(), res).open()
			);
			if (!details) { new Notice("Cancelled"); return; }

			const chosen      = templates.find(t => t.name === details.templateName) ?? templates[0];
			const engine      = new WCEngine(doc, { ...pageData, reason: details.reason, category: details.category });
			const noteContent = buildNote(chosen.tpl, engine);

			// For URI/clipboard clips, use the template's path setting
			const folder = chosen.tpl.path || "";
			if (folder) await this.ensureFolder(folder);
			const safeName = pageData.title.replace(/[\\/:*?"<>|]/g, "").substring(0, 80).trim() || "Clipping";
			const path     = folder ? `${folder}/${safeName}.md` : `${safeName}.md`;

			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await this.app.vault.modify(existing, noteContent);
			else await this.app.vault.create(path, noteContent);

			new Notice(`✅ Clipped: ${safeName}`);
		} catch (err) {
			console.error("Share Clipper:", err);
			new Notice(`❌ ${(err as Error).message}`);
		}
	}

	private existingCategories(): string[] {
		const cats = new Set<string>();
		this.app.vault.getMarkdownFiles().forEach(f => {
			const cat = this.app.metadataCache.getFileCache(f)?.frontmatter?.category;
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════════════════

class ShareClipperSettingTab extends PluginSettingTab {
	plugin: ShareClipperPlugin;
	constructor(app: App, plugin: ShareClipperPlugin) { super(app, plugin); this.plugin = plugin; }

	display() {
		const { containerEl: el } = this;
		el.empty();
		el.createEl("h2", { text: "Share Clipper" });

		el.createEl("h3", { text: "Templates" });

		new Setting(el)
			.setName("Templates folder")
			.setDesc("Vault folder containing your Web Clipper template notes. Each note's content is the template JSON.")
			.addText(t => t.setPlaceholder("Templates/Web Clipper").setValue(this.plugin.settings.templateFolder)
				.onChange(async v => { this.plugin.settings.templateFolder = v; await this.plugin.saveSettings(); }));

		new Setting(el)
			.setName("Default template")
			.setDesc("Template to pre-select when no URL trigger matches. Use the `name` field from the JSON.")
			.addText(t => t.setPlaceholder("Default").setValue(this.plugin.settings.defaultTemplate)
				.onChange(async v => { this.plugin.settings.defaultTemplate = v; await this.plugin.saveSettings(); }));

		new Setting(el)
			.setName("Template builder")
			.setDesc("Create and edit templates using the official Web Clipper JSON schema.")
			.addButton(b => b.setButtonText("Open template builder")
				.onClick(() => new TemplateBuilderModal(this.app, this.plugin).open()));

		el.createEl("h3", { text: "Advanced" });

		new Setting(el)
			.setName("Detection delay (ms)")
			.setDesc("How long to wait after a note is created before checking for a shared URL. Default: 1500.")
			.addText(t => t.setValue(String(this.plugin.settings.watchDelay))
				.onChange(async v => {
					const n = parseInt(v);
					if (!isNaN(n)) { this.plugin.settings.watchDelay = n; await this.plugin.saveSettings(); }
				}));

		el.createEl("h3", { text: "How it works" });
		el.createEl("p", {
			text: "Share any page from your browser to Obsidian. Obsidian will ask for a filename, then create the note. " +
			      "This plugin detects the new note, fetches the page, shows a quick dialog for template/reason/category, " +
			      "and rewrites the note in place using your chosen template. The file stays wherever Obsidian put it.",
			cls: "setting-item-description",
		});
		el.createEl("p", {
			text: "Templates are standard Obsidian Web Clipper JSON — any template from the community repo works without modification. " +
			      "Paste the JSON into a note in your templates folder.",
			cls: "setting-item-description",
		});
		el.createEl("p", {
			text: "Not available (browser-only): {{highlights}}, {{selection}}, {{prompt:}} (AI).",
			cls: "setting-item-description",
		});
	}
}
