// app/layout.js
export const metadata = {
  title: 'Hemline Market',
  description: 'List and discover fabrics on Hemline Market',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#333333" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,Apple Color Emoji,Segoe UI Emoji',
          color: '#333333',
          background: '#ffffff',
        }}
      >
        {children}
      </body>
    </html>
  );
}
