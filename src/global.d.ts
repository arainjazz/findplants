import "react";

// Allow the non-standard `webkitdirectory` attribute on <input type="file">,
// which turns the file picker into a folder picker. Supported by all major
// browsers but missing from React's built-in JSX types.
declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}
