// Prefix root-relative markdown links with the site base path,
// so content can keep writing [/posts/xxx/] while the site is served
// from a sub-path (e.g. GitHub Pages project pages).

const BASE = "/cjh_fuwari/";

function walk(node, fn) {
	if (node.type === "link" && typeof node.url === "string") {
		fn(node);
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) walk(child, fn);
	}
}

export function remarkBaseLinks() {
	return (tree) => {
		walk(tree, (node) => {
			const url = node.url;
			if (!url.startsWith("/")) return;
			if (url.startsWith("//")) return;
			if (url.startsWith(BASE)) return;
			node.url = BASE.replace(/\/$/, "") + url;
		});
	};
}
