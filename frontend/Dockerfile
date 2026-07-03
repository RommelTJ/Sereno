FROM node:24-alpine

WORKDIR /app

# Install dependencies first so this layer caches across source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev"]
