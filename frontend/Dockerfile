# Stage 1: Building the code
FROM node:18-alpine AS builder

WORKDIR /app

# Copy the package.json and package-lock.json (or yarn.lock)
COPY app/package*.json ./

# Install dependencies with the legacy-peer-deps option to bypass the conflict.
RUN npm install --legacy-peer-deps

# Copy the rest of your source code
COPY app/ .

# Make sure to copy the pages directory
COPY app/pages ./pages

# Build the project, this will create the .next folder
RUN npm run build


# Stage 2: Running the code
FROM node:18-alpine

WORKDIR /app

# Copy from the builder stage the installed dependencies and the built code
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/components ./components
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/tailwind.config.js ./
COPY --from=builder /app/postcss.config.mjs ./

# Ensure the pages directory is copied over
COPY --from=builder /app/pages ./pages
COPY --from=builder /app/styles ./styles

# Expose the listening port of your app
EXPOSE 3000

# Start the Next.js application
CMD ["npm", "run", "dev"]
