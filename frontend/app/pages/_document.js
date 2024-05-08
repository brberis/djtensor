import Document, { Html, Head, Main, NextScript } from 'next/document';

class MyDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest" async></script>
          <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-vis@latest" async></script>
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
