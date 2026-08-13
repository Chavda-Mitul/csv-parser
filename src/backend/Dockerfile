FROM node:20-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build


FROM node:20-alpine

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=build /usr/src/app/dist ./dist

USER node

EXPOSE 3000

CMD ["npm", "start"]