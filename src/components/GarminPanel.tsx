import { canShareFiles } from '../lib/share';

interface Props {
  onShare: () => void;
  onSave: () => void;
}

/** Ways to get the GPX into Garmin Connect, with short how-to steps. */
export default function GarminPanel({ onShare, onSave }: Props) {
  const share = canShareFiles();
  return (
    <div className="garmin">
      {share && (
        <div className="garmin-way">
          <button type="button" className="btn ghost" onClick={onShare}>
            Share to Connect
          </button>
          <p className="hint">
            Don’t see Connect? Swipe the row of apps to the end, tap <b>More</b>, and switch on <b>Connect</b>.
          </p>
        </div>
      )}
      <div className="garmin-way">
        <button type="button" className="btn ghost" onClick={onSave}>
          Save GPX file
        </button>
        <p className="hint">
          Then open the <b>Files</b> app → Downloads, hold the file, tap <b>Share</b> and pick <b>Connect</b>. On a computer:
          connect.garmin.com → Training → Courses → Import.
        </p>
      </div>
      <p className="hint">Connect saves it as a course and syncs it to your watch.</p>
    </div>
  );
}
