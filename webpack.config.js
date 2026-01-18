import path from 'path';
import { fileURLToPath } from 'url';

import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
    mode: 'production',
    devtool: 'source-map',
    entry: {
        popup: './src/popup.js',
        background: './src/background.js',
        content: './src/content.js',
    },
    output: {
        path: path.resolve(__dirname, 'build'),
        filename: '[name].js',
        clean: true,
    },
    resolve: {
        extensions: ['.js', '.json'],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/popup.html',
            filename: 'popup.html',
            chunks: ['popup'],
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: 'public',
                    to: '.',
                },
                {
                    from: 'src/popup.css',
                    to: 'popup.css',
                },
                // Copy ONNX runtime WASM files for local loading
                {
                    from: 'node_modules/@huggingface/transformers/dist/*.wasm',
                    to: '[name][ext]',
                },
                {
                    from: 'node_modules/@huggingface/transformers/dist/*.mjs',
                    to: '[name][ext]',
                },
            ],
        }),
    ],
    optimization: {
        minimize: true,
    },
};

export default config;
