FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Rendered at container start by nginx's envsubst entrypoint, so API_UPSTREAM
# can repoint /api without rebuilding the image.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=backend:8080
# Substitute only API_UPSTREAM; nginx runtime vars ($uri, $host, ...) must survive.
ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM
EXPOSE 80
