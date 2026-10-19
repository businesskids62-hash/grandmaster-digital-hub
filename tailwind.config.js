/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          navy: {
            900: '#060B18',
            800: '#0A1128',
            700: '#101B3B',
            600: '#1C2A52',
            500: '#283B6F',
          },
          gold: {
            400: '#F5C542',
            500: '#D4AF37',
            600: '#B89225',
            700: '#947214',
          },
          accent: {
            blue: '#2563EB',
            cyan: '#06B6D4',
          }
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        urdu: ['Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
