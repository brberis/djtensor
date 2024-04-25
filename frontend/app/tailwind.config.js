const colors = require('tailwindcss/colors')

module.exports = {
  purge: [
    './components/**/*.tsx',
    './components/**/*.js',
    './pages/**/*.tsx',
    './pages/**/*.js',
  ],
  theme: {
    extend: {
      rotate: {
        '90': '-90deg',
      },
      colors: {
        rose: colors.rose,
      },
      fontFamily: {
        tangled2: ["KG Tangled 2", "sans-serif"],      
      },
    },
  },
  variants: {},
  plugins: [
    require('@tailwindcss/forms'),
    require('flowbite/plugin')
  ],
  content: [
    "./node_modules/flowbite/**/*.js",
  ]
}
