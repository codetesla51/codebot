import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Use classic reactivity for this project.
		runes: false
	},
	kit: {
		adapter: adapter()
	}
};

export default config;
