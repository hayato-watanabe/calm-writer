/** esbuild の dataurl ローダーで埋め込む画像アセット */
declare module "*.png" {
	const dataUrl: string;
	export default dataUrl;
}
