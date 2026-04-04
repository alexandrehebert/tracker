FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4109

ENV NODE_ENV=development
ENV PORT=4109

CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
