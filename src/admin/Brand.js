// Website > Brand and layout > Logo and brand images (phase 15 step 9; API /brand in brand.js). Three uploads, each a
// tile with the picture used now, where it is used, Upload and (for an upload) Remove = back to the logo of today:
// square logo (app icon, admin header, stamp), wide logo (invoice and document header) and the favicon (one square
// picture; the 16, 32, 180, 192 and 512 pixel sizes are made from it). PNG, JPG or WebP up to 1 MB. Until something is
// uploaded the site, the admin and the documents use the logo files of today, unchanged.
import { useRef } from 'react';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { splitMsg } from './Units';
import { Alert, LIcon, Loading, PageHead, Pill, useAdmin, useCan, useConfirm, useLoad, useToast, useUpload, UploadProgress } from './ui';

const TILES = [
  { kind: 'square', title: 'Square logo', shape: '1:1, at least 192 x 192 (512 x 512 is best)', use: 'App icon, admin header and its tab icon, stamp' },
  { kind: 'wide', title: 'Wide logo', shape: 'Landscape, at least 300 pixels wide', use: 'Invoice, credit note and statement header (PDF)' },
  { kind: 'favicon', title: 'Favicon', shape: '1:1, at least 192 x 192 (512 x 512 is best)', use: 'The website tab icon and the phone home-screen icon' },
];

export default function Brand() {
  const data = useLoad('/brand');
  const { me } = useAdmin();
  const canEdit = useCan('content', 'edit');
  const up = useUpload();
  const toast = useToast();
  const confirm = useConfirm();
  const inputs = useRef({});
  const d = data.data;
  const pick = async (kind, file) => {
    if (!file) return;
    try {
      const out = await up.send(kind, `/brand/${kind}`, file);
      toast('good', out.message.replace(/\.$/, ''), 'The website, the admin and new documents use it now.');
      data.reload();
    } catch (e) { const [t, x] = splitMsg(e.message, 'Not added'); toast('bad', t, x); }
  };
  const remove = async (t) => {
    if (!(await confirm({ title: `Remove the ${t.title.toLowerCase()}?`, message: 'The logo of today is used again. Documents made from now on print with it.', action: 'Remove', danger: true }))) return;
    try { const out = await api.send('DELETE', `/brand/${t.kind}`); toast('good', `${t.title} removed`, out.message); data.reload(); } catch (e) { toast('bad', 'Not removed', e.message); }
  };
  return (
    <section>
      <PageHead sub="Change the logo without a developer" />
      {!canEdit && <Alert tone="info" title="View only.">{me && me.role_name ? `${me.role_name} can` : 'Your role can'} see these pictures but not change them.</Alert>}
      <Alert tone="info" title="One place for the logo.">The website, the admin and every PDF read these pictures. Until one is uploaded they use the logo of today, so nothing changes. Admin &gt; Company shows them read only.</Alert>
      <UploadProgress state={up.state} />
      <Loading state={data}>
        {d && (
          <div className="a-p15-brand">
            {TILES.map((t) => (
              <div key={t.kind} className="a-card a-p15-btile">
                <div className="a-p15-bimg">
                  {t.kind === 'favicon' ? (
                    <div className="a-p15-favs">
                      {d.favicons.filter((f) => f.url).map((f) => <img key={f.size} src={mediaUrl(f.url)} alt="" width={Math.min(f.size, 64)} height={Math.min(f.size, 64)} title={`${f.size} x ${f.size}`} />)}
                    </div>
                  ) : <img src={mediaUrl(d[t.kind])} alt={t.title} />}
                </div>
                <div className="a-p15-btxt">
                  <b>{t.title}</b>
                  <Pill tone={d.uploaded[t.kind] ? 'gold' : 'gray'}>{d.uploaded[t.kind] ? 'Uploaded' : 'The logo of today'}</Pill>
                  <small className="a-muted">{t.shape}</small>
                  <small>Used for: {t.use}</small>
                  {t.kind === 'favicon' && <small className="a-muted">Sizes made: {d.sizes.join(', ')} pixels.</small>}
                  {canEdit && (
                    <span className="a-p15-row">
                      <input ref={(el) => { inputs.current[t.kind] = el; }} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={`${t.title} file`}
                        onChange={(e) => { pick(t.kind, e.target.files[0]); e.target.value = ''; }} />
                      <button type="button" className="a-btn a-btn-sm" disabled={up.busy} onClick={() => inputs.current[t.kind].click()}><LIcon name="upload" size="sm" />Upload</button>
                      {d.uploaded[t.kind] && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={up.busy} onClick={() => remove(t)}>Remove</button>}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <p className="a-hint-s">PNG, JPG or WebP, up to 1 MB. A transparent PNG looks best on every background.</p>
          </div>
        )}
      </Loading>
    </section>
  );
}
