# Stage 1: Building the code
FROM node:18-alpine AS builder

WORKDIR /app

# Copy the package.json and package-lock.json (or yarn.lock)
COPY app/package*.json ./

# Install dependencies with the legacy-peer-deps option to bypass the conflict.
RUN npm install --legacy-peer-deps

# Copy the rest of your source code
COPY app/ .

# Build the project, this will create the .next folder
RUN npm run build


# Stage 2: Running the code
FROM node:18-alpine

WORKDIR /app

# Copy from the builder stage the installed dependencies and the built code
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./


# Expose the listening port of your app
EXPOSE 3000

# Start the Next.js application
CMD ["npm", "start"]
