import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#172033',
        muted: '#667085',
        panel: '#ffffff',
        canvas: '#f6f8fc',
        brand: { 50: '#f2f3ff', 100: '#e8e9ff', 500: '#5b5bd6', 600: '#4f46c8', 700: '#4338aa' }
      },
      boxShadow: { soft: '0 10px 30px rgba(26, 35, 70, 0.06)' },
      borderRadius: { xl: '14px' }
    }
  },
  plugins: []
};
export default config;
