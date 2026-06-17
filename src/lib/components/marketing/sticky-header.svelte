<script lang="ts">
	import EasedGradient from './eased-gradient.svelte';
	import GradientBlur from './gradient-blur.svelte';
	import { easeOutQuad } from './vesta-utils';
	import { onMount, type Snippet } from 'svelte';

	type Props = {
		logo?: Snippet;
		nav?: Snippet;
		actions?: Snippet;
		class?: string;
	};

	let { logo, nav, actions, class: className = '' }: Props = $props();
	let headerElement: HTMLElement;
	let heroVisible = $state(true);
	let heroIntersectionRatio = $state(0);
	let scrollProgress = $state(0);

	const initialHeaderBackgroundBottom = 0;
	const peakHeaderBackgroundBottom = -500;
	const settledHeaderBackgroundBottom = -150;

	const backgroundBottomFor = (progress: number): number => {
		if (progress <= 0) return initialHeaderBackgroundBottom;
		if (progress < 0.2)
			return (
				initialHeaderBackgroundBottom +
				(peakHeaderBackgroundBottom - initialHeaderBackgroundBottom) * (progress / 0.2)
			);
		if (progress < 0.9)
			return (
				peakHeaderBackgroundBottom +
				(settledHeaderBackgroundBottom - peakHeaderBackgroundBottom) * ((progress - 0.2) / 0.7)
			);
		return settledHeaderBackgroundBottom;
	};

	const headerBackgroundBottom = $derived(`${backgroundBottomFor(heroIntersectionRatio)}%`);
	const scrollProgressRight = $derived(`${100 - scrollProgress * 100}%`);

	const scrollParent = (element: HTMLElement): HTMLElement | Document => {
		let parent = element.parentElement;
		while (parent) {
			const style = getComputedStyle(parent);
			const scrollableY = /(auto|scroll|overlay)/.test(style.overflowY);
			if (scrollableY && parent.scrollHeight > parent.clientHeight) return parent;
			parent = parent.parentElement;
		}
		return document;
	};

	onMount(() => {
		const header = headerElement;
		const main =
			header.nextElementSibling instanceof HTMLElement ? header.nextElementSibling : null;
		const hero =
			main?.querySelector<HTMLElement>('section[data-section="hero"]') ??
			document.querySelector<HTMLElement>('section[data-section="hero"]');
		const root = document.documentElement;
		const setHeaderHeight = () => {
			root.style.setProperty('--marketing-header-height', `${header.clientHeight}px`);
		};
		const headerSizeObserver = new ResizeObserver(setHeaderHeight);

		setHeaderHeight();
		headerSizeObserver.observe(header);

		const scroller = scrollParent(header);
		const scrollElement =
			scroller === document ? document.documentElement : (scroller as HTMLElement);
		const rootBounds = () => {
			if (scroller === document) return { top: 0, bottom: window.innerHeight };
			const rect = (scroller as HTMLElement).getBoundingClientRect();
			return { top: rect.top, bottom: rect.bottom };
		};

		const updateHeroTimeline = () => {
			if (!hero) {
				heroVisible = false;
				return;
			}

			const rect = hero.getBoundingClientRect();
			const root = rootBounds();
			const fullHeroVisible = rect.top >= root.top && rect.bottom <= root.bottom;
			const visibleHeight = Math.min(rect.bottom, root.bottom) - Math.max(rect.top, root.top);
			const visibleRatio = Math.max(0, visibleHeight) / Math.max(1, rect.height);
			const exitProgress = Math.max(0, root.top - rect.top) / Math.max(1, rect.height * 0.9);

			heroVisible = visibleRatio > 0.1;
			heroIntersectionRatio = fullHeroVisible ? 0 : Math.min(1, exitProgress);
		};

		const updateProgress = () => {
			const maxScroll = Math.max(1, scrollElement.scrollHeight - scrollElement.clientHeight);
			scrollProgress = Math.min(1, Math.max(0, scrollElement.scrollTop / maxScroll));
			updateHeroTimeline();
		};
		updateProgress();
		scrollElement.addEventListener('scroll', updateProgress, { passive: true });
		window.addEventListener('resize', updateProgress, { passive: true });

		return () => {
			headerSizeObserver.disconnect();
			root.style.removeProperty('--marketing-header-height');
			scrollElement.removeEventListener('scroll', updateProgress);
			window.removeEventListener('resize', updateProgress);
		};
	});
</script>

<header
	bind:this={headerElement}
	data-marketing-header
	data-hero-visible={heroVisible}
	class="fixed top-0 right-0 left-0 isolate z-50 flex w-full items-center justify-center {className}"
	style={`--bottom:${headerBackgroundBottom};--scroll-progress-right:${scrollProgressRight}`}
>
	<GradientBlur
		data-section="header-background"
		class="header-blur"
		blur={12}
		detail={8}
		mask={{ type: 'linear', angle: 'to top' }}
	/>

	<EasedGradient
		class="header-gradient"
		data-section="header-background"
		detail={8}
		easeFunction={easeOutQuad}
		gradient={{
			type: 'linear',
			angle: 'to bottom',
			stops: ['var(--background) 0%', 'transparent 100%']
		}}
	/>

	<div class="header-card">
		{#if logo}
			{@render logo()}
		{/if}
		{#if nav}
			<div class="flex min-w-0 flex-1 justify-center">
				{@render nav()}
			</div>
		{/if}
		{#if actions}
			<div class="flex shrink-0 items-center gap-6">
				{@render actions()}
			</div>
		{/if}
		<div class="header-border" aria-hidden="true"></div>
		<div class="header-scroll-progress" aria-hidden="true"></div>
	</div>
</header>

<style>
	:global(header[data-marketing-header] + main section:first-of-type) {
		padding-top: calc(var(--marketing-header-height, 4rem) + 2rem);
	}

	:global(.header-blur),
	.header-gradient {
		--header-background-peak-bottom: -500%;
		--header-background-settled-bottom: -150%;
		position: absolute;
		z-index: -20;
		inset: 0 0 var(--bottom) 0;
		pointer-events: none;
		transition: bottom 300ms ease;
	}

	.header-card {
		position: relative;
		z-index: 10;
		display: flex;
		width: min(80rem, 100%);
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		overflow: clip;
		padding: 1rem;
		color: var(--foreground);
		transition:
			width 300ms ease,
			margin-top 300ms ease,
			border-color 300ms ease,
			border-radius 300ms ease,
			background-color 300ms ease,
			box-shadow 300ms ease;
	}

	@media (width >= 48rem) {
		.header-card {
			padding-right: 1.5rem;
			padding-left: 1.5rem;
		}
	}

	[data-hero-visible='false'] .header-card {
		width: min(80rem, calc(100% - 2rem));
		margin-top: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.875rem;
		background: color-mix(in oklab, var(--background) 72%, transparent);
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.04);
		backdrop-filter: blur(12px);
	}

	.header-border,
	.header-scroll-progress {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 1px;
	}

	.header-border {
		right: 0;
		background: var(--border);
	}

	.header-scroll-progress {
		right: var(--scroll-progress-right);
		background: var(--brand-salmon);
		transition: right 120ms linear;
	}

	@supports (view-timeline: --hero-timeline) and (animation-timeline: --hero-timeline) and
		(animation-range: exit 0% 90%) and (timeline-scope: --hero-timeline) {
		:global(:root) {
			timeline-scope: --hero-timeline;
		}

		@property --bottom {
			syntax: '<length-percentage>';
			initial-value: 0%;
			inherits: false;
		}

		:global(section[data-section='hero']) {
			view-timeline: --hero-timeline block;
		}

		@keyframes header-background {
			0% {
				--bottom: 0%;
			}
			20% {
				--bottom: var(--header-background-peak-bottom);
			}
			90%,
			100% {
				--bottom: var(--header-background-settled-bottom);
			}
		}

		:global(.header-blur),
		.header-gradient {
			animation: header-background linear both;
			animation-timeline: --hero-timeline;
			animation-range: exit 0% 90%;
		}
	}

	@property --bottom {
		syntax: '<length-percentage>';
		initial-value: 0%;
		inherits: false;
	}
</style>
