// Error boundary around the admin content area (AdminApp): if a screen throws while rendering, the page shows
// "This screen could not load - Reload" in place of that screen and the sidebar keeps working. AdminApp gives it
// key={pathname}, so moving to another screen starts clean. The error goes to the console.
import { Component } from 'react';

export default class ScreenBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[admin] screen could not load:', error, info && info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="a-note a-note-error a-crash" role="alert">
        <span>This screen could not load - </span>
        <button type="button" className="a-btn a-btn-sm" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
