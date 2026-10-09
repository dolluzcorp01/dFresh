// Section eyebrow with the leaf-hand icon (preview: <p class="k"><img> text</p> in .sh headers).
import { mediaUrl } from '../utils/api';

export default function Kicker({ children }) {
  return (
    <p className="k">
      <img src={mediaUrl('/media/logo/dfresh-icon.webp')} alt="" width="26" height="17" draggable="false" />
      <span>{children}</span>
    </p>
  );
}
