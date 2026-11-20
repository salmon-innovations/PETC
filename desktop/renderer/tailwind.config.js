/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontSize: {
        // Accessible scale: base is 18px for elderly/visually impaired users
        xs:    ["0.8125rem",  { lineHeight: "1.5"  }],  // 13px
        sm:    ["0.9375rem",  { lineHeight: "1.55" }],  // 15px
        base:  ["1.0625rem",  { lineHeight: "1.6"  }],  // 17px
        lg:    ["1.1875rem",  { lineHeight: "1.6"  }],  // 19px
        xl:    ["1.3125rem",  { lineHeight: "1.5"  }],  // 21px
        "2xl": ["1.5rem",     { lineHeight: "1.4"  }],  // 24px
        "3xl": ["1.875rem",   { lineHeight: "1.35" }],  // 30px
        "4xl": ["2.25rem",    { lineHeight: "1.2"  }],  // 36px
        "5xl": ["3rem",       { lineHeight: "1.1"  }],  // 48px
      },
      colors: {
        // Eye-friendly slate panel palette
        panel: {
          950: "#0b1120",
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
          600: "#475569",
          400: "#94a3b8",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9",
        },
      },
      minHeight: {
        touch: "2.75rem", // 44px — WCAG minimum touch target
      },
      boxShadow: {
        "glow-emerald": "0 0 12px 2px rgba(52,211,153,0.25)",
        "glow-amber":   "0 0 12px 2px rgba(251,191,36,0.25)",
        card:           "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "card-lg":      "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        glow:         "pulse-glow 2s ease-in-out infinite",
        shimmer:      "shimmer 2s linear infinite",
        float:        "float 6s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)"   },
          "50%":      { transform: "translateY(-8px)" },
        },
      },
      transitionTimingFunction: {
        "bounce-sm": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
};
