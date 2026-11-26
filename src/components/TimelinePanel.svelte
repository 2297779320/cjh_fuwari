<script lang="ts">
import { getPostUrlBySlug } from "../utils/url-utils";

interface Post {
	slug: string;
	data: {
		title: string;
		tags: string[];
		category?: string | null;
		published: Date;
	};
}

export let sortedPosts: Post[] = [];

interface YearGroup {
	year: number;
	posts: Post[];
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function formatDate(date: Date) {
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	return `${month}-${day}`;
}

// 在初始化阶段完成分组：服务端与客户端渲染结果一致
const map = new Map<number, Post[]>();
for (const post of sortedPosts) {
	const year = toDate(post.data.published).getFullYear();
	if (!map.has(year)) map.set(year, []);
	map.get(year)!.push(post);
}
const groups: YearGroup[] = [...map.entries()]
	.map(([year, posts]) => ({ year, posts }))
	.sort((a, b) => b.year - a.year);
</script>

<div class="card-base px-6 py-8 md:px-10">
	{#each groups as group (group.year)}
		<section class="mb-10 last:mb-0">
			<div class="mb-5 flex items-center gap-4">
				<div class="text-2xl font-bold text-[var(--primary)] md:text-3xl">{group.year}</div>
				<div class="h-px flex-1 bg-black/10 dark:bg-white/10"></div>
				<div class="text-sm text-50">{group.posts.length} 篇</div>
			</div>
			<ol class="relative ml-2 border-l border-dashed border-black/15 pl-6 dark:border-white/15">
				{#each group.posts as post (post.slug)}
					<li class="relative pb-6 last:pb-1">
						<span
							class="absolute top-1.5 -left-[7.5px] h-3 w-3 rounded-full bg-[var(--primary)] ring-4 ring-[var(--card-bg)]"
						></span>
						<a href={getPostUrlBySlug(post.slug)} class="group block" aria-label={post.data.title}>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-50">
								<time datetime={toDate(post.data.published).toISOString()}>
									{formatDate(toDate(post.data.published))}
								</time>
								{#if post.data.category}
									<span class="rounded-full bg-[var(--btn-regular-bg)] px-2 py-0.5 text-[var(--btn-content)]">
										{post.data.category}
									</span>
								{/if}
								{#if post.data.tags?.length}
									<span class="truncate">{post.data.tags.map((t) => `#${t}`).join(" ")}</span>
								{/if}
							</div>
							<div
								class="mt-1 font-bold text-75 transition-all group-hover:translate-x-1 group-hover:text-[var(--primary)]"
							>
								{post.data.title}
							</div>
						</a>
					</li>
				{/each}
			</ol>
		</section>
	{/each}
	{#if groups.length === 0}
		<div class="py-10 text-center text-50">暂无文章</div>
	{/if}
</div>