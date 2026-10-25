FROM node:24-bookworm-slim AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY assets/ /app/assets/
RUN npm run build

FROM nginx:stable-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx-proxy.conf /etc/nginx/proxy_params_zone
COPY --from=build /app/frontend/dist/ /usr/share/nginx/html/
EXPOSE 80
