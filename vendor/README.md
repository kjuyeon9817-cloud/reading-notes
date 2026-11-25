`anthropic-sdk.js`는 공식 Anthropic TypeScript SDK(`@anthropic-ai/sdk@1.8.0`)를 브라우저용 파일 하나로 묶은 것이에요.

다시 만들 때:

```sh
npm i @anthropic-ai/sdk@1.8.0 esbuild
echo "export { default } from '@anthropic-ai/sdk';" > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=browser --minify --outfile=anthropic-sdk.js
```
