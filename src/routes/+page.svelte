<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	type Protocol = 'HTTP' | 'TCP' | 'TLS';
	type TunnelStatus = 'online' | 'offline';
	type Tunnel = {
		id: string;
		name: string;
		url: string;
		protocol: Protocol;
		status: TunnelStatus;
		uptime: string;
		rpm: number;
		port: number;
		subdomain: string;
	};
	type RequestLog = {
		id: string;
		method: 'GET' | 'POST' | 'DELETE';
		path: string;
		status: number;
		latency: number;
		timestamp: number;
		headers: Record<string, string>;
		body: Record<string, unknown>;
		response: Record<string, unknown>;
		timeline: { label: string; value: number }[];
	};
	type Toast = { id: string; message: string; tone?: 'success' | 'info' | 'error' };
	type Metrics = {
		totalRequests: number;
		avgLatency: number;
		errorRate: number;
		activeTunnels: number;
	};
	type Settings = {
		apiKey: string;
		region: string;
		tls: boolean;
		compression: boolean;
		webhookUrl: string;
	};
	type ChartPoint = { label: string; value: number };
	type ContactForm = {
		name: string;
		email: string;
		company: string;
		message: string;
	};
	type ContactErrors = Partial<Record<keyof ContactForm, string>>;

	const navItems = [
		{ id: 'tunnels', label: 'Tunnels', icon: 'tunnels' },
		{ id: 'inspector', label: 'Traffic Inspector', icon: 'inspector' },
		{ id: 'metrics', label: 'Metrics', icon: 'metrics' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	] as const;

	const methodColors: Record<RequestLog['method'], string> = {
		GET: '#3ba7ff',
		POST: '#ffd166',
		DELETE: '#ff6b6b'
	};

	const protocols: Protocol[] = ['HTTP', 'TCP', 'TLS'];
	const contactStorageKey = 'tunnlr-contact-submissions';
	const maxContactSubmissions = 25;
	const mockSubmissionDelayMs = 600;
	const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
	const heroCardPoints = [
		'Single-page mocked control plane',
		'Live traffic stream simulation',
		'No backend required'
	];

	let currentView: (typeof navItems)[number]['id'] = 'tunnels';
	let loading = true;
	let showNewTunnelModal = false;
	let selectedRequest: RequestLog | null = null;
	let methodFilter: 'all' | RequestLog['method'] = 'all';
	let statusFilter: 'all' | '2xx' | '3xx' | '4xx' | '5xx' = 'all';
	let pathQuery = '';
	let trafficInterval: ReturnType<typeof setInterval> | null = null;
	let chartInterval: ReturnType<typeof setInterval> | null = null;
	let toasts: Toast[] = [];
	let contactForm: ContactForm = {
		name: '',
		email: '',
		company: '',
		message: ''
	};
	let contactErrors: ContactErrors = {};
	let contactStatus: 'idle' | 'submitting' | 'success' | 'error' = 'idle';
	let contactMessage = '';

	let tunnels: Tunnel[] = [
		{
			id: crypto.randomUUID(),
			name: 'Payments Edge',
			url: 'https://pay-921d.tunnel.dev',
			protocol: 'HTTP',
			status: 'online',
			uptime: '4h 12m',
			rpm: 148,
			port: 3000,
			subdomain: 'pay-921d'
		},
		{
			id: crypto.randomUUID(),
			name: 'Webhook Relay',
			url: 'https://hooks-cc2.tunnel.dev',
			protocol: 'TLS',
			status: 'online',
			uptime: '1d 2h',
			rpm: 96,
			port: 4000,
			subdomain: 'hooks-cc2'
		},
		{
			id: crypto.randomUUID(),
			name: 'TCP Broker',
			url: 'tcp://relay-5c8f.tunnel.dev:5402',
			protocol: 'TCP',
			status: 'offline',
			uptime: '32m',
			rpm: 0,
			port: 5402,
			subdomain: 'relay-5c8f'
		}
	];

	let requests: RequestLog[] = [];
	let filteredRequests: RequestLog[];

	let metrics: Metrics = {
		totalRequests: 128_420,
		avgLatency: 182,
		errorRate: 0.6,
		activeTunnels: tunnels.filter((t) => t.status === 'online').length
	};

	let chartData: ChartPoint[] = buildInitialChart();

	let settings: Settings = {
		apiKey: 'sk_live_b90a3f21d7aa18',
		region: 'us-east-1',
		tls: true,
		compression: true,
		webhookUrl: 'https://hooks.tunnel.dev/events'
	};

	let newTunnel = {
		name: '',
		port: '',
		protocol: 'HTTP' as Protocol,
		subdomain: ''
	};

	onMount(() => {
		const stored = sessionStorage.getItem('tunnlr-settings');
		if (stored) {
			settings = { ...settings, ...JSON.parse(stored) } satisfies Settings;
		}

		requests = seedRequests();
		setTimeout(() => (loading = false), 300);

		trafficInterval = setInterval(() => {
			const req = generateRequest();
			requests = [req, ...requests].slice(0, 80);
			updateMetricsWithRequest(req);
		}, 800);

		chartInterval = setInterval(() => {
			pushChartPoint();
		}, 5000);
	});

	onDestroy(() => {
		if (trafficInterval) {
			clearInterval(trafficInterval);
		}
		if (chartInterval) {
			clearInterval(chartInterval);
		}
	});

	$: filteredRequests = requests
		.filter((req) => {
			const methodPass = methodFilter === 'all' || req.method === methodFilter;
			const statusPass =
				statusFilter === 'all' ||
				(statusFilter === '2xx' && req.status >= 200 && req.status < 300) ||
				(statusFilter === '3xx' && req.status >= 300 && req.status < 400) ||
				(statusFilter === '4xx' && req.status >= 400 && req.status < 500) ||
				(statusFilter === '5xx' && req.status >= 500);
			const pathPass = req.path.toLowerCase().includes(pathQuery.toLowerCase());
			return methodPass && statusPass && pathPass;
		})
		.sort((a, b) => b.timestamp - a.timestamp);

	$: metrics.activeTunnels = tunnels.filter((t) => t.status === 'online').length;
	$: sessionStorage?.setItem('tunnlr-settings', JSON.stringify(settings));

	function seedRequests() {
		const basePaths = [
			'/auth/login',
			'/billing/charge',
			'/webhooks/order',
			'/api/usage',
			'/health'
		];
		return basePaths.map((path) => generateRequest(path));
	}

	function generateRequest(pathOverride?: string): RequestLog {
		const methods: RequestLog['method'][] = ['GET', 'POST', 'DELETE'];
		const paths = pathOverride
			? [pathOverride]
			: ['/auth/login', '/billing', '/webhooks/orders', '/metrics', '/health', '/files/upload'];
		const statuses = [200, 200, 201, 204, 301, 404, 500, 502, 429];
		const method = methods[Math.floor(Math.random() * methods.length)];
		const status = statuses[Math.floor(Math.random() * statuses.length)];
		const latency = Math.floor(Math.random() * 220) + 30;
		const now = Date.now();
		return {
			id: crypto.randomUUID(),
			method,
			path: pathOverride ?? paths[Math.floor(Math.random() * paths.length)],
			status,
			latency,
			timestamp: now,
			headers: {
				'content-type': 'application/json',
				'user-agent': 'Mozilla/5.0',
				'x-request-id': crypto.randomUUID().slice(0, 8)
			},
			body: {
				message: 'hello world',
				requestId: crypto.randomUUID().slice(0, 6)
			},
			response: {
				success: status < 400,
				trace: crypto.randomUUID().slice(0, 8)
			},
			timeline: [
				{ label: 'Connect', value: Math.floor(latency * 0.18) },
				{ label: 'TLS', value: Math.floor(latency * 0.22) },
				{ label: 'Wait', value: Math.floor(latency * 0.3) },
				{ label: 'Download', value: Math.floor(latency * 0.3) }
			]
		};
	}

	function buildInitialChart(): ChartPoint[] {
		const now = Date.now();
		return Array.from({ length: 60 }, (_, i) => {
			const minutesAgo = 59 - i;
			const label = formatTime(now - minutesAgo * 60_000);
			return { label, value: 80 + Math.round(Math.random() * 90) };
		});
	}

	function buildChartPoints(data: ChartPoint[]) {
		const width = 760;
		const height = 240;
		const max = Math.max(...data.map((d) => d.value), 1);
		const plotHeight = height - 24;
		const points = data.map((point, index) => {
			const x = (index / Math.max(data.length - 1, 1)) * width;
			const y = plotHeight - (point.value / max) * (plotHeight - 24) + 8;
			return `${x},${y}`;
		});
		return ['0,' + height, ...points, `${width},${height}`].join(' ');
	}

	function pushChartPoint() {
		const nextPoint = {
			label: formatTime(Date.now()),
			value: 90 + Math.round(Math.random() * 140)
		};
		chartData = [...chartData.slice(-59), nextPoint];
		metrics.totalRequests += nextPoint.value;
		metrics.avgLatency = Math.round(metrics.avgLatency * 0.9 + nextPoint.value * 0.02);
		metrics.errorRate = Math.max(0.3, Math.min(4, metrics.errorRate + (Math.random() - 0.5) * 0.2));
	}

	function formatTime(ts: number) {
		return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(ts);
	}

	function addToast(message: string, tone: Toast['tone'] = 'success') {
		const id = crypto.randomUUID();
		toasts = [...toasts, { id, message, tone }];
		setTimeout(() => removeToast(id), 3000);
	}

	function removeToast(id: string) {
		toasts = toasts.filter((toast) => toast.id !== id);
	}

	function copy(text: string, label: string) {
		navigator.clipboard
			.writeText(text)
			.then(() => addToast(`${label} copied`))
			.catch(() => addToast(`Unable to copy ${label}`, 'error'));
	}

	function toggleTunnel(id: string) {
		tunnels = tunnels.map((tunnel) => {
			if (tunnel.id !== id) return tunnel;
			const goingOffline = tunnel.status === 'online';
			return {
				...tunnel,
				status: goingOffline ? 'offline' : 'online',
				rpm: goingOffline ? 0 : 80 + Math.round(Math.random() * 120)
			};
		});
		const tunnel = tunnels.find((t) => t.id === id);
		if (tunnel)
			addToast(`${tunnel.status === 'online' ? 'Started' : 'Stopped'} ${tunnel.name}`, 'info');
	}

	function deleteTunnel(id: string) {
		const target = tunnels.find((t) => t.id === id);
		if (!target) return;
		const confirmed = confirm(`Delete tunnel “${target.name}”? This cannot be undone.`);
		if (!confirmed) return;
		tunnels = tunnels.filter((t) => t.id !== id);
		addToast(`Deleted ${target.name}`, 'info');
	}

	function openNewTunnelModal() {
		resetNewTunnel();
		showNewTunnelModal = true;
	}

	function resetNewTunnel() {
		newTunnel = { name: '', port: '', protocol: 'HTTP', subdomain: '' };
	}

	function createTunnel() {
		if (!newTunnel.name || !newTunnel.port) {
			addToast('Name and port are required', 'error');
			return;
		}
		const subdomain =
			newTunnel.subdomain ||
			`${newTunnel.name.toLowerCase().replace(/\s+/g, '-')}-${Math.random()
				.toString(16)
				.slice(2, 5)}`;
		const urlPrefix = newTunnel.protocol === 'TCP' ? 'tcp://' : 'https://';
		const url = `${urlPrefix}${subdomain}.tunnel.dev${newTunnel.protocol === 'TCP' ? `:${newTunnel.port}` : ''}`;
		const tunnel: Tunnel = {
			id: crypto.randomUUID(),
			name: newTunnel.name,
			url,
			protocol: newTunnel.protocol,
			status: 'online',
			uptime: 'just now',
			rpm: 80 + Math.round(Math.random() * 70),
			port: Number(newTunnel.port),
			subdomain
		};
		tunnels = [tunnel, ...tunnels];
		showNewTunnelModal = false;
		addToast(`${tunnel.name} created`);
		resetNewTunnel();
	}

	function updateMetricsWithRequest(req: RequestLog) {
		metrics.totalRequests += 1;
		metrics.avgLatency = Math.round(metrics.avgLatency * 0.92 + req.latency * 0.08);
		const errorBump = req.status >= 500 ? 0.15 : req.status >= 400 ? 0.08 : -0.05;
		metrics.errorRate = Math.max(
			0.2,
			Math.min(6, Number((metrics.errorRate + errorBump).toFixed(2)))
		);
	}

	function regenerateKey() {
		settings = {
			...settings,
			apiKey: `sk_live_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
		};
		addToast('API key regenerated');
	}

	function resetTunnels() {
		const ok = confirm('Reset all tunnels and clear traffic? This cannot be undone.');
		if (!ok) return;
		tunnels = [];
		requests = [];
		selectedRequest = null;
		addToast('All tunnels reset', 'info');
	}

	function maskKey(key: string) {
		return `•••• •••• ${key.slice(-6)}`;
	}

	function iconPath(name: string) {
		const paths: Record<string, string> = {
			tunnels:
				'M4 7h16M4 12h16M4 17h16M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
			inspector:
				'm2.25 12 8.954-8.955a1.5 1.5 0 0 1 2.122 0L22.5 12l-9.174 8.955a1.5 1.5 0 0 1-2.122 0L2.25 12Z',
			metrics: 'M3 3v18h18M7 15l3-3 3 2 5-7',
			settings:
				'M12 15.75A3.75 3.75 0 1 0 12 8.25a3.75 3.75 0 0 0 0 7.5Zm8.094-3.495.197.114a.75.75 0 0 1 .333.84l-.187.744a.75.75 0 0 0 .165.693l.542.625a.75.75 0 0 1-.013.996l-.75.75a.75.75 0 0 1-.996.013l-.625-.542a.75.75 0 0 0-.693-.165l-.744.187a.75.75 0 0 1-.84-.333l-.114-.197a.75.75 0 0 0-.643-.375h-.885a.75.75 0 0 0-.643.375l-.114.197a.75.75 0 0 1-.84.333l-.744-.187a.75.75 0 0 0-.693.165l-.625.542a.75.75 0 0 1-.996-.013l-.75-.75a.75.75 0 0 1-.013-.996l.542-.625a.75.75 0 0 0 .165-.693l-.187-.744a.75.75 0 0 1 .333-.84l.197-.114a.75.75 0 0 0 .375-.643v-.885a.75.75 0 0 0-.375-.643l-.197-.114a.75.75 0 0 1-.333-.84l.187-.744a.75.75 0 0 0-.165-.693l-.542-.625a.75.75 0 0 1 .013-.996l.75-.75a.75.75 0 0 1 .996-.013l.625.542a.75.75 0 0 0 .693.165l.744-.187a.75.75 0 0 1 .84.333l.114.197a.75.75 0 0 0 .643.375h.885a.75.75 0 0 0 .643-.375l.114-.197a.75.75 0 0 1 .84-.333l.744.187a.75.75 0 0 0 .693-.165l.625-.542a.75.75 0 0 1 .996.013l.75.75a.75.75 0 0 1 .013.996l-.542.625a.75.75 0 0 0-.165.693l.187.744a.75.75 0 0 1-.333.84l-.197.114a.75.75 0 0 0-.375.643v.885a.75.75 0 0 0 .375.643Z',
			plus: 'M12 5v14M5 12h14',
			share:
				'M7.5 10.5 12 6m0 0 4.5 4.5M12 6v12M4.5 15.75v3a.75.75 0 0 0 .75.75h13.5a.75.75 0 0 0 .75-.75v-3',
			emptyTunnels: 'M3 7.5h18M3 12h18M3 16.5h18',
			emptyRequests: 'M3 6.75h18v10.5H3zM3 6.75l9 6 9-6',
			emptyMetrics: 'M4.5 19.5 12 4.5l7.5 15h-15Z'
		};
		return paths[name];
	}

	function validateContactForm() {
		const nextErrors: ContactErrors = {};
		if (!contactForm.name.trim()) nextErrors.name = 'Name is required.';
		if (!contactForm.email.trim()) {
			nextErrors.email = 'Email is required.';
		} else if (!emailRegex.test(contactForm.email)) {
			nextErrors.email = 'Enter a valid email.';
		}
		if (!contactForm.company.trim()) nextErrors.company = 'Company is required.';
		if (!contactForm.message.trim()) {
			nextErrors.message = 'Message is required.';
		} else if (contactForm.message.trim().length < 20) {
			nextErrors.message = 'Message must be at least 20 characters.';
		}
		contactErrors = nextErrors;
		return Object.keys(nextErrors).length === 0;
	}

	async function submitContact(event: SubmitEvent) {
		event.preventDefault();
		contactMessage = '';
		if (!validateContactForm()) {
			contactStatus = 'error';
			contactMessage = 'Please fix the highlighted fields.';
			return;
		}

		contactStatus = 'submitting';
		await new Promise((resolve) => setTimeout(resolve, mockSubmissionDelayMs));
		try {
			const existing = localStorage.getItem(contactStorageKey);
			let submissions: Array<Record<string, unknown>> = [];
			if (existing) {
				try {
					const parsed: unknown = JSON.parse(existing);
					if (Array.isArray(parsed)) {
						submissions = parsed.filter(
							(entry): entry is Record<string, unknown> =>
								typeof entry === 'object' && entry !== null && !Array.isArray(entry)
						);
					}
				} catch {
					contactStatus = 'error';
					contactMessage = 'Stored contact data is invalid. Please try again.';
					return;
				}
			}
			submissions.unshift({
				id: crypto.randomUUID(),
				createdAt: new Date().toISOString(),
				...contactForm
			});
			localStorage.setItem(
				contactStorageKey,
				JSON.stringify(submissions.slice(0, maxContactSubmissions))
			);
			contactForm = { name: '', email: '', company: '', message: '' };
			contactErrors = {};
			contactStatus = 'success';
			contactMessage = 'Message sent. We saved it locally in this browser session.';
		} catch {
			contactStatus = 'error';
			contactMessage = 'Failed to process your message.';
		}
	}

	function revealOnScroll(node: HTMLElement) {
		if (
			typeof window === 'undefined' ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			node.classList.add('is-visible');
			return {
				destroy() {}
			};
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						node.classList.add('is-visible');
						observer.unobserve(node);
					}
				}
			},
			{ threshold: 0.2 }
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			}
		};
	}

	const statusTags: Record<Protocol, string> = { HTTP: 'HTTP', TCP: 'TCP', TLS: 'TLS' };
</script>

<svelte:head>
	<title>tunnlr — Live Tunneling Dashboard</title>
	<meta
		name="description"
		content="Mocked ngrok-style tunneling control plane built in SvelteKit."
	/>
</svelte:head>

<div class="page">
	<aside class="sidebar card">
		<div class="logo">
			<div class="glyph">t</div>
			<div class="brand">
				<span class="eyebrow">tunnlr</span>
				<strong>Control</strong>
			</div>
		</div>
		<nav class="nav">
			{#each navItems as item (item.id)}
				<button
					class={`nav-item ${currentView === item.id ? 'active' : ''}`}
					on:click={() => (currentView = item.id)}
				>
					<span class="icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" class="heroicon">
							<path d={iconPath(item.id)}></path>
						</svg>
					</span>
					<span class="nav-label">{item.label}</span>
				</button>
			{/each}
		</nav>
		<div class="sidebar-footer">
			<div class="status">
				<div
					class={`status-dot ${metrics.activeTunnels > 0 ? '' : 'offline'}`}
					style={`background:${metrics.activeTunnels > 0 ? '#00ff88' : '#555'}`}
				></div>
				<div>
					<p class="eyebrow">Status</p>
					<strong>{metrics.activeTunnels} active tunnels</strong>
				</div>
			</div>
			<button class="pill-button" on:click={openNewTunnelModal}>
				<svg viewBox="0 0 24 24" class="heroicon" aria-hidden="true">
					<path d={iconPath('plus')}></path>
				</svg>
				<span class="nav-label">New Tunnel</span>
			</button>
		</div>
	</aside>

	<main class="content">
		<section class="hero card is-visible">
			<div class="hero-copy">
				<p class="eyebrow">tunnlr dashboard</p>
				<h2>Single-page mocked tunneling control plane</h2>
				<p class="muted">
					Everything runs entirely on the client with mock data, live request simulation, and zero
					backend setup.
				</p>
				<div class="hero-actions">
					<button class="primary" on:click={() => (currentView = 'tunnels')}>Open dashboard</button>
					<button class="pill-button" on:click={() => copy(window.location.href, 'Share link')}>
						<svg viewBox="0 0 24 24" class="heroicon" aria-hidden="true">
							<path d={iconPath('share')}></path>
						</svg>
						Share view
					</button>
				</div>
			</div>
			<div class="hero-points card">
				{#each heroCardPoints as point (point)}
					<div class="hero-point">
						<svg viewBox="0 0 24 24" class="heroicon" aria-hidden="true">
							<path d={iconPath('metrics')}></path>
						</svg>
						<span>{point}</span>
					</div>
				{/each}
			</div>
		</section>

		<header class="page-header">
			<div>
				<p class="eyebrow">Live tunneling</p>
				<h1>Unified control plane</h1>
				<p class="muted">
					Manage tunnels, inspect traffic, and tune settings without leaving this page.
				</p>
			</div>
			<div class="header-actions">
				<div class="badge">
					<div class="status-dot" style="background: #00ff88"></div>
					Live
				</div>
				<button class="pill-button" on:click={() => copy(window.location.href, 'Share link')}>
					<svg viewBox="0 0 24 24" class="heroicon" aria-hidden="true">
						<path d={iconPath('share')}></path>
					</svg>
					Share view
				</button>
			</div>
		</header>

		<section class="panel reveal" use:revealOnScroll>
			{#if currentView === 'tunnels'}
				{#if loading}
					<div class="skeleton-table">
						{#each Array.from({ length: 4 }, (_, idx) => idx) as idx (idx)}
							<div class="skeleton-row" style={`animation-delay:${idx * 60}ms`}></div>
						{/each}
					</div>
				{:else}
					<div class="section-top">
						<div>
							<h2>Tunnels</h2>
							<p class="muted">Spin up ngrok-style endpoints and manage uptime in one place.</p>
						</div>
						<button class="primary" on:click={openNewTunnelModal}>New Tunnel</button>
					</div>
					{#if tunnels.length === 0}
						<div class="empty">
							<div class="icon">
								<svg viewBox="0 0 24 24" class="heroicon" aria-hidden="true">
									<path d={iconPath('emptyTunnels')}></path>
								</svg>
							</div>
							<div>
								<h3>No tunnels</h3>
								<p class="muted">Create a tunnel to start proxying traffic.</p>
							</div>
						</div>
					{:else}
						<div class="table card">
							<div class="table-head">
								<span>Name</span>
								<span>URL</span>
								<span>Protocol</span>
								<span>Status</span>
								<span>Uptime</span>
								<span>Req/min</span>
								<span class="actions">Actions</span>
							</div>
							{#each tunnels as tunnel (tunnel.id)}
								<div class="table-row">
									<div>
										<strong>{tunnel.name}</strong>
										<p class="muted mono">:{tunnel.port}</p>
									</div>
									<div class="mono url-cell">
										{tunnel.url}
									</div>
									<div>
										<span class="pill">{statusTags[tunnel.protocol]}</span>
									</div>
									<div class="status-cell">
										<div
											class={`status-dot ${tunnel.status === 'online' ? '' : 'offline'}`}
											style={`background:${tunnel.status === 'online' ? '#00ff88' : '#555'}`}
										></div>
										<span class={tunnel.status === 'online' ? 'muted success' : 'muted'}>
											{tunnel.status}
										</span>
									</div>
									<div class="muted">{tunnel.uptime}</div>
									<div class="muted">{tunnel.rpm}</div>
									<div class="row-actions">
										<button class="ghost" on:click={() => copy(tunnel.url, 'URL')}>Copy</button>
										<button class="ghost" on:click={() => toggleTunnel(tunnel.id)}>
											{tunnel.status === 'online' ? 'Stop' : 'Start'}
										</button>
										<button class="ghost danger" on:click={() => deleteTunnel(tunnel.id)}
											>Delete</button
										>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			{:else if currentView === 'inspector'}
				{#if loading}
					<div class="skeleton-table">
						{#each Array.from({ length: 6 }, (_, idx) => idx) as idx (idx)}
							<div class="skeleton-row" style={`height:64px; animation-delay:${idx * 50}ms`}></div>
						{/each}
					</div>
				{:else}
					<div class="section-top">
						<div>
							<h2>Traffic Inspector</h2>
							<p class="muted">Live stream of inbound requests. Click to drill into payloads.</p>
						</div>
						<div class="filters">
							<select bind:value={methodFilter}>
								<option value="all">Any method</option>
								<option value="GET">GET</option>
								<option value="POST">POST</option>
								<option value="DELETE">DELETE</option>
							</select>
							<select bind:value={statusFilter}>
								<option value="all">Any status</option>
								<option value="2xx">2xx</option>
								<option value="3xx">3xx</option>
								<option value="4xx">4xx</option>
								<option value="5xx">5xx</option>
							</select>
							<input type="search" placeholder="Search path" bind:value={pathQuery} />
						</div>
					</div>
					<div class="inspector">
						<div class="table card">
							<div class="table-head">
								<span>Method</span>
								<span>Path</span>
								<span>Status</span>
								<span>Latency</span>
								<span>Time</span>
							</div>
							{#if filteredRequests.length === 0}
								<div class="empty">
									<div class="icon">
										<svg viewBox="0 0 24 24" class="heroicon" aria-hidden="true">
											<path d={iconPath('emptyRequests')}></path>
										</svg>
									</div>
									<div>
										<h3>No requests yet</h3>
										<p class="muted">Traffic will stream in automatically.</p>
									</div>
								</div>
							{:else}
								{#each filteredRequests as req (req.id)}
									<button class="table-row" on:click={() => (selectedRequest = req)}>
										<span
											class="method"
											style={`color:${methodColors[req.method]}; border-color:${methodColors[req.method]}`}
										>
											{req.method}
										</span>
										<span class="mono">{req.path}</span>
										<span class={req.status >= 500 ? 'bad' : req.status >= 400 ? 'warn' : 'good'}
											>{req.status}</span
										>
										<span>{req.latency} ms</span>
										<span class="muted">{formatTime(req.timestamp)}</span>
									</button>
								{/each}
							{/if}
						</div>

						<div class={`drawer ${selectedRequest ? 'open' : ''}`}>
							{#if selectedRequest}
								<div class="drawer-header">
									<div>
										<p class="eyebrow mono">{selectedRequest.id.slice(0, 8)}</p>
										<h3 class="mono">{selectedRequest.method} {selectedRequest.path}</h3>
									</div>
									<button class="ghost" on:click={() => (selectedRequest = null)}>Close</button>
								</div>
								<div class="drawer-grid">
									<div>
										<p class="muted">Request Headers</p>
										<pre class="mono">{JSON.stringify(selectedRequest.headers, null, 2)}</pre>
									</div>
									<div>
										<p class="muted">Request Body</p>
										<pre class="mono">{JSON.stringify(selectedRequest.body, null, 2)}</pre>
									</div>
									<div>
										<p class="muted">Response</p>
										<pre class="mono">{JSON.stringify(selectedRequest.response, null, 2)}</pre>
									</div>
									<div class="timeline">
										<p class="muted">Timing breakdown</p>
										<div class="timeline-bars">
											{#each selectedRequest.timeline as step (step.label)}
												<div class="timeline-row">
													<span>{step.label}</span>
													<div class="bar">
														<div
															style={`width:${Math.min(step.value / selectedRequest.latency, 1) * 100}%;`}
														></div>
													</div>
													<span class="muted">{step.value} ms</span>
												</div>
											{/each}
										</div>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			{:else if currentView === 'metrics'}
				{#if loading}
					<div class="skeleton-grid">
						{#each Array.from({ length: 4 }, (_, idx) => idx) as idx (idx)}
							<div class="skeleton-card" style={`animation-delay:${idx * 80}ms`}></div>
						{/each}
					</div>
				{:else}
					<div class="section-top">
						<div>
							<h2>Metrics</h2>
							<p class="muted">Stat cards, live SVG sparkline, and per-tunnel breakdowns.</p>
						</div>
					</div>
					<div class="stat-grid">
						<div class="stat card">
							<p class="muted">Total Requests</p>
							<h3>{metrics.totalRequests.toLocaleString()}</h3>
							<p class="muted">rolling 24h</p>
						</div>
						<div class="stat card">
							<p class="muted">Avg Latency</p>
							<h3>{metrics.avgLatency} ms</h3>
							<p class="muted">p95 under 300ms</p>
						</div>
						<div class="stat card">
							<p class="muted">Error Rate</p>
							<h3>{metrics.errorRate}%</h3>
							<p class="muted">4xx + 5xx</p>
						</div>
						<div class="stat card">
							<p class="muted">Active Tunnels</p>
							<h3>{metrics.activeTunnels}</h3>
							<p class="muted">pulsing when online</p>
						</div>
					</div>

					<div class="chart card">
						<div class="chart-head">
							<div>
								<p class="muted">Requests · last 60 mins</p>
								<h3>{chartData[chartData.length - 1]?.value ?? 0} rpm</h3>
							</div>
							<div class="badge mono">Update: 5s</div>
						</div>
						<svg viewBox="0 0 760 240" role="img" aria-label="Requests over time">
							<defs>
								<linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
									<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.4" />
									<stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
								</linearGradient>
							</defs>
							{#if chartData.length}
								<polyline
									fill="url(#grad)"
									stroke="var(--accent)"
									stroke-width="3"
									points={buildChartPoints(chartData)}
								/>
							{/if}
							<g class="chart-grid">
								{#each [1, 2, 3, 4] as line (line)}
									<line x1="0" x2="760" y1={line * 50} y2={line * 50} />
								{/each}
							</g>
						</svg>
					</div>

					<div class="table card">
						<div class="table-head">
							<span>Tunnel</span>
							<span>Protocol</span>
							<span>Status</span>
							<span>Requests/min</span>
							<span>Latency</span>
						</div>
						{#if tunnels.length === 0}
							<div class="empty">
								<div class="icon">
									<svg viewBox="0 0 24 24" class="heroicon" aria-hidden="true">
										<path d={iconPath('emptyMetrics')}></path>
									</svg>
								</div>
								<div>
									<h3>No data</h3>
									<p class="muted">Create tunnels to populate metrics.</p>
								</div>
							</div>
						{:else}
							{#each tunnels as tunnel (tunnel.id)}
								<div class="table-row">
									<span>{tunnel.name}</span>
									<span class="pill">{tunnel.protocol}</span>
									<span class={tunnel.status === 'online' ? 'good' : 'muted'}>{tunnel.status}</span>
									<span>{tunnel.rpm}</span>
									<span
										>{Math.max(90, metrics.avgLatency - 40 + Math.round(Math.random() * 60))} ms</span
									>
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			{:else}
				<!-- Settings -->
				{#if loading}
					<div class="skeleton-grid">
						{#each Array.from({ length: 3 }, (_, idx) => idx) as idx (idx)}
							<div
								class="skeleton-card"
								style={`animation-delay:${idx * 90}ms; height:160px`}
							></div>
						{/each}
					</div>
				{:else}
					<div class="section-top">
						<div>
							<h2>Settings</h2>
							<p class="muted">Account, defaults, and safety levers.</p>
						</div>
					</div>
					<div class="settings-grid">
						<div class="card">
							<div class="card-header">
								<div>
									<p class="eyebrow">Account</p>
									<h3>API Key</h3>
								</div>
								<div class="pill">Secure</div>
							</div>
							<div class="field">
								<p class="label-title">Current key</p>
								<div class="input mono">
									<span>{maskKey(settings.apiKey)}</span>
									<div class="field-actions">
										<button class="ghost" on:click={() => copy(settings.apiKey, 'API key')}
											>Copy</button
										>
										<button class="ghost" on:click={regenerateKey}>Regenerate</button>
									</div>
								</div>
							</div>
						</div>

						<div class="card">
							<div class="card-header">
								<div>
									<p class="eyebrow">Defaults</p>
									<h3>Tunnel options</h3>
								</div>
							</div>
							<div class="field">
								<label for="region-select">Region</label>
								<select id="region-select" bind:value={settings.region}>
									<option value="us-east-1">us-east-1</option>
									<option value="eu-west-1">eu-west-1</option>
									<option value="ap-south-1">ap-south-1</option>
								</select>
							</div>
							<div class="field toggle">
								<div>
									<label for="tls-toggle">TLS termination</label>
									<p class="muted">Handle TLS at the edge.</p>
								</div>
								<label class="switch">
									<input id="tls-toggle" type="checkbox" bind:checked={settings.tls} />
									<span></span>
								</label>
							</div>
							<div class="field toggle">
								<div>
									<label for="compression-toggle">Compression</label>
									<p class="muted">Reduce payload size on the fly.</p>
								</div>
								<label class="switch">
									<input
										id="compression-toggle"
										type="checkbox"
										bind:checked={settings.compression}
									/>
									<span></span>
								</label>
							</div>
							<div class="field">
								<label for="webhook-url">Webhook URL</label>
								<input
									id="webhook-url"
									type="url"
									placeholder="https://"
									class="mono"
									bind:value={settings.webhookUrl}
								/>
							</div>
						</div>

						<div class="card danger-zone">
							<div class="card-header">
								<div>
									<p class="eyebrow">Danger</p>
									<h3>Reset all tunnels</h3>
								</div>
							</div>
							<p class="muted">Wipe tunnels and traffic history. This asks for confirmation.</p>
							<button class="danger" on:click={resetTunnels}>Reset</button>
						</div>
					</div>
				{/if}
			{/if}
		</section>

		<section class="contact card reveal" use:revealOnScroll>
			<div class="section-top">
				<div>
					<p class="eyebrow">Contact</p>
					<h2>Get in touch</h2>
					<p class="muted">
						Send product questions, implementation feedback, or integration requests for tunnlr.
					</p>
				</div>
			</div>
			<form class="contact-form" on:submit={submitContact} novalidate>
				<div class="contact-grid">
					<label>
						<span>Name</span>
						<input
							type="text"
							bind:value={contactForm.name}
							aria-invalid={Boolean(contactErrors.name)}
							placeholder="Your name"
						/>
						{#if contactErrors.name}<small class="form-error">{contactErrors.name}</small>{/if}
					</label>
					<label>
						<span>Email</span>
						<input
							type="email"
							bind:value={contactForm.email}
							aria-invalid={Boolean(contactErrors.email)}
							placeholder="you@company.com"
						/>
						{#if contactErrors.email}<small class="form-error">{contactErrors.email}</small>{/if}
					</label>
					<label>
						<span>Company</span>
						<input
							type="text"
							bind:value={contactForm.company}
							aria-invalid={Boolean(contactErrors.company)}
							placeholder="Company name"
						/>
						{#if contactErrors.company}<small class="form-error">{contactErrors.company}</small
							>{/if}
					</label>
				</div>
				<label>
					<span>Message</span>
					<textarea
						rows="5"
						bind:value={contactForm.message}
						aria-invalid={Boolean(contactErrors.message)}
						placeholder="Tell us what you are building with tunnels."
					></textarea>
					{#if contactErrors.message}<small class="form-error">{contactErrors.message}</small>{/if}
				</label>
				<div class="contact-actions">
					<button class="primary" type="submit" disabled={contactStatus === 'submitting'}>
						{contactStatus === 'submitting' ? 'Sending...' : 'Send message'}
					</button>
					{#if contactMessage}
						<p class={contactStatus === 'success' ? 'good' : 'bad'}>{contactMessage}</p>
					{/if}
				</div>
			</form>
		</section>

		<footer class="footer reveal" use:revealOnScroll>
			<p class="muted mono">
				tunnlr dashboard · mocked control plane built with SvelteKit + TypeScript.
			</p>
		</footer>
	</main>
</div>

{#if showNewTunnelModal}
	<div
		class="modal"
		role="button"
		tabindex="0"
		aria-label="Close new tunnel modal"
		on:click={() => (showNewTunnelModal = false)}
		on:keydown={(event) => {
			if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
				showNewTunnelModal = false;
			}
		}}
	>
		<div
			class="modal-card card"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			on:click|stopPropagation
			on:keydown|stopPropagation
		>
			<div class="modal-head">
				<h3>New tunnel</h3>
				<button class="ghost" on:click={() => (showNewTunnelModal = false)}>Close</button>
			</div>
			<div class="modal-grid">
				<label>
					<span>Name</span>
					<input type="text" placeholder="Staging API" bind:value={newTunnel.name} />
				</label>
				<label>
					<span>Port</span>
					<input type="number" placeholder="3000" bind:value={newTunnel.port} />
				</label>
				<label>
					<span>Protocol</span>
					<select bind:value={newTunnel.protocol}>
						{#each protocols as protocol (protocol)}
							<option value={protocol}>{protocol}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Subdomain</span>
					<input
						type="text"
						placeholder="auto-generated if empty"
						bind:value={newTunnel.subdomain}
					/>
				</label>
			</div>
			<div class="modal-actions">
				<button class="ghost" on:click={resetNewTunnel}>Reset</button>
				<button class="primary" on:click={createTunnel}>Create</button>
			</div>
		</div>
	</div>
{/if}

<div class="toast-stack">
	{#each toasts as toast (toast.id)}
		<div class={`toast card ${toast.tone ?? 'success'}`}>
			<span>{toast.message}</span>
			<button class="ghost" on:click={() => removeToast(toast.id)}>×</button>
		</div>
	{/each}
</div>

<style>
	:global(button),
	:global(input),
	:global(select),
	:global(textarea) {
		min-height: 44px;
		min-width: 44px;
	}

	.heroicon {
		width: 18px;
		height: 18px;
		stroke: currentColor;
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.75;
	}

	.reveal {
		opacity: 0;
		transform: translateY(10px);
		transition:
			opacity 280ms ease,
			transform 280ms ease;
	}

	.reveal.is-visible {
		opacity: 1;
		transform: translateY(0);
	}

	.page {
		display: grid;
		grid-template-columns: 260px 1fr;
		min-height: 100vh;
		gap: 16px;
		padding: 16px;
	}

	.sidebar {
		padding: 18px;
		position: sticky;
		top: 12px;
		height: calc(100vh - 24px);
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.glyph {
		width: 42px;
		height: 42px;
		border-radius: 12px;
		background: linear-gradient(135deg, #00ff88, #005533);
		display: grid;
		place-items: center;
		font-weight: 700;
		color: #0a0a0a;
		text-transform: uppercase;
	}

	.brand strong {
		font-size: 18px;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 12px;
		color: var(--muted);
		margin: 0 0 2px;
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 10px;
		flex: 1;
	}

	.nav-item {
		border: 1px solid var(--border);
		background: #121212;
		color: inherit;
		border-radius: 12px;
		padding: 12px;
		display: flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
		transition: all 150ms ease;
		text-align: left;
	}

	.nav-item .icon {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: #161616;
		border: 1px solid var(--border);
	}

	.nav-item.active {
		border-color: rgba(0, 255, 136, 0.6);
		box-shadow: 0 0 0 1px rgba(0, 255, 136, 0.12);
		background: radial-gradient(circle at 20% 20%, rgba(0, 255, 136, 0.08), #101010);
	}

	.nav-item:hover {
		transform: translateY(-1px);
	}

	.nav-label {
		white-space: nowrap;
	}

	.sidebar-footer {
		display: grid;
		gap: 10px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: #131313;
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.hero {
		display: grid;
		grid-template-columns: 1.2fr 0.9fr;
		gap: 14px;
		padding: 16px;
		animation: heroEnter 360ms ease;
	}

	@keyframes heroEnter {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.hero-copy {
		display: grid;
		gap: 10px;
		align-content: center;
	}

	.hero-copy h2 {
		margin: 0;
		font-size: clamp(24px, 3vw, 34px);
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.hero-points {
		padding: 12px;
		display: grid;
		gap: 8px;
		align-content: center;
	}

	.hero-point {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px;
		border-radius: 10px;
		background: #0f0f0f;
		border: 1px solid var(--border);
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 4px 8px;
	}

	h1 {
		margin: 0;
		font-size: 28px;
	}

	h2 {
		margin: 0;
		font-size: 22px;
	}

	h3 {
		margin: 6px 0;
	}

	.muted {
		color: var(--muted);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.panel {
		display: block;
	}

	.section-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}

	.table {
		display: grid;
		gap: 6px;
		padding: 12px;
	}

	.table-head,
	.table-row {
		display: grid;
		grid-template-columns: 1.4fr 2.1fr 0.9fr 0.9fr 0.8fr 0.8fr 1.2fr;
		align-items: center;
		gap: 10px;
	}

	.table-head {
		color: var(--muted);
		font-size: 13px;
		padding: 6px 6px;
	}

	.table-row {
		padding: 10px 8px;
		border-radius: 10px;
		background: #0f0f0f;
		border: 1px solid var(--border);
		transition:
			background 150ms ease,
			transform 150ms ease;
	}

	.table-row:hover {
		background: #121212;
		transform: translateY(-1px);
	}

	.row-actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}

	.ghost {
		border: 1px solid var(--border);
		background: #131313;
		color: inherit;
		padding: 8px 12px;
		border-radius: 10px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.ghost:hover {
		border-color: #2a2a2a;
	}

	.ghost.danger {
		color: #ff6b6b;
		border-color: rgba(255, 107, 107, 0.3);
	}

	.primary {
		background: linear-gradient(135deg, var(--accent), var(--accent-strong));
		color: #0a0a0a;
		border: none;
		padding: 10px 16px;
		border-radius: 12px;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 12px 40px rgba(0, 255, 136, 0.22);
		transition: transform 150ms ease;
	}

	.primary:hover {
		transform: translateY(-1px);
	}

	.url-cell {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		padding: 6px 10px;
		border-radius: 12px;
		background: #151515;
		border: 1px solid var(--border);
		font-size: 13px;
	}

	.status-cell {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.actions {
		text-align: right;
	}

	.skeleton-table {
		display: grid;
		gap: 8px;
	}

	.skeleton-row {
		height: 54px;
		border-radius: 12px;
		background: #0f0f0f;
		overflow: hidden;
		position: relative;
	}

	.skeleton-row::after,
	.skeleton-card::after {
		content: '';
		position: absolute;
		top: 0;
		left: -100%;
		width: 100%;
		height: 100%;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
		animation: shimmer 1.1s infinite;
	}

	.skeleton-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
	}

	.skeleton-card {
		height: 140px;
		background: #0f0f0f;
		border-radius: 14px;
		position: relative;
		overflow: hidden;
	}

	.filters {
		display: flex;
		gap: 8px;
	}

	.filters select,
	.filters input,
	.field select,
	.field input {
		background: #101010;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 9px 12px;
		color: inherit;
	}

	.filters input {
		min-width: 180px;
	}

	.inspector {
		display: grid;
		grid-template-columns: 1.2fr 0.9fr;
		gap: 12px;
	}

	.inspector .table-row {
		grid-template-columns: 0.8fr 2fr 0.8fr 0.8fr 1fr;
		text-align: left;
	}

	.method {
		padding: 6px 10px;
		border-radius: 10px;
		border: 1px solid;
		background: #0f0f0f;
		font-weight: 700;
	}

	.good {
		color: #00ff88;
	}

	.warn {
		color: #ffd166;
	}

	.bad {
		color: #ff6b6b;
	}

	.drawer {
		background: #0f0f0f;
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 14px;
		transform: translateX(8px);
		opacity: 0;
		pointer-events: none;
		transition: all 150ms ease;
		overflow: hidden;
	}

	.drawer.open {
		opacity: 1;
		transform: translateX(0);
		pointer-events: auto;
	}

	.drawer-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}

	.drawer-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 10px;
	}

	pre {
		background: #0c0c0c;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 10px;
		margin: 4px 0 0;
		white-space: pre-wrap;
	}

	.timeline-bars {
		display: grid;
		gap: 10px;
	}

	.timeline-row {
		display: grid;
		grid-template-columns: 100px 1fr 60px;
		align-items: center;
		gap: 8px;
	}

	.bar {
		background: #111;
		border: 1px solid var(--border);
		border-radius: 999px;
		height: 10px;
		overflow: hidden;
	}

	.bar div {
		height: 100%;
		background: linear-gradient(90deg, #00ff88, #00995a);
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}

	.stat {
		padding: 14px;
	}

	.chart {
		padding: 12px;
	}

	.chart-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.chart svg {
		width: 100%;
		height: 240px;
		margin-top: 8px;
	}

	.chart-grid line {
		stroke: rgba(255, 255, 255, 0.04);
		stroke-width: 1;
	}

	.settings-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 14px;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 12px 6px;
	}

	.field {
		display: grid;
		gap: 6px;
		padding: 0 12px 12px;
	}

	.label-title {
		margin: 0;
		font-weight: 600;
	}

	.field-actions {
		display: flex;
		gap: 6px;
	}

	.toggle {
		grid-template-columns: 1fr auto;
		align-items: center;
	}

	.switch {
		position: relative;
		display: inline-block;
		width: 48px;
		height: 24px;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.switch span {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: #1a1a1a;
		transition: 150ms ease;
		border-radius: 24px;
		border: 1px solid var(--border);
	}

	.switch span::before {
		position: absolute;
		content: '';
		height: 18px;
		width: 18px;
		left: 3px;
		bottom: 2px;
		background: white;
		transition: 150ms ease;
		border-radius: 50%;
	}

	.switch input:checked + span {
		background: linear-gradient(135deg, var(--accent), var(--accent-strong));
		border-color: rgba(0, 255, 136, 0.5);
	}

	.switch input:checked + span::before {
		transform: translateX(22px);
	}

	.danger-zone {
		border: 1px solid rgba(255, 107, 107, 0.4);
	}

	.danger {
		background: #2b0d0d;
		border: 1px solid rgba(255, 107, 107, 0.4);
		color: #ffb3b3;
		padding: 10px 14px;
		border-radius: 10px;
		cursor: pointer;
	}

	.empty {
		text-align: center;
		padding: 32px 16px;
		display: grid;
		place-items: center;
		gap: 6px;
	}

	.empty .icon {
		font-size: 26px;
	}

	.modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.65);
		display: grid;
		place-items: center;
		padding: 16px;
		backdrop-filter: blur(8px);
		z-index: 20;
	}

	.modal-card {
		width: min(640px, 96vw);
		padding: 14px;
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.modal-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 10px;
	}

	.modal-grid label {
		display: grid;
		gap: 6px;
		font-size: 14px;
	}

	.modal-grid input,
	.modal-grid select {
		background: #0f0f0f;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 10px;
		color: inherit;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}

	.toast-stack {
		position: fixed;
		top: 18px;
		right: 18px;
		display: grid;
		gap: 8px;
		z-index: 40;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
	}

	.toast.info {
		border-color: rgba(0, 255, 136, 0.3);
	}

	.toast.error {
		border-color: rgba(255, 107, 107, 0.5);
	}

	.contact {
		padding: 14px;
	}

	.contact-form {
		display: grid;
		gap: 12px;
	}

	.contact-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}

	.contact-form label {
		display: grid;
		gap: 6px;
	}

	.contact-form input,
	.contact-form textarea {
		background: #101010;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 10px 12px;
		color: inherit;
	}

	.contact-form textarea {
		resize: vertical;
		min-height: 140px;
	}

	.contact-form input[aria-invalid='true'],
	.contact-form textarea[aria-invalid='true'] {
		border-color: rgba(255, 107, 107, 0.5);
	}

	.form-error {
		color: #ff6b6b;
		font-size: 12px;
	}

	.contact-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}

	.footer {
		padding: 10px 4px 4px;
	}

	@media (max-width: 1024px) {
		.hero {
			grid-template-columns: 1fr;
		}

		.page {
			grid-template-columns: 88px 1fr;
		}

		.nav-label,
		.sidebar-footer .nav-label,
		.sidebar-footer .brand,
		.logo .brand,
		.sidebar-footer .pill-button span:not(.icon) {
			display: none;
		}

		.sidebar {
			padding: 12px;
			gap: 14px;
		}

		.nav-item {
			justify-content: center;
		}

		.status {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	@media (max-width: 900px) {
		.page {
			grid-template-columns: 1fr;
		}

		.sidebar {
			position: static;
			height: auto;
			flex-direction: row;
			align-items: center;
		}

		.nav {
			flex-direction: row;
			flex-wrap: wrap;
			justify-content: flex-start;
		}

		.content {
			padding-bottom: 80px;
		}

		.inspector {
			grid-template-columns: 1fr;
		}

		.contact-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.table-head,
		.table-row,
		.inspector .table-row {
			grid-template-columns: 1fr;
			text-align: left;
		}

		.row-actions {
			justify-content: flex-start;
			flex-wrap: wrap;
		}

		.filters {
			flex-direction: column;
		}
	}
</style>
