/**
 * Inline in <head> (Phase 5e amendment 2): when this load will restore something, the sheet waits, unseen, for the
 * restored state instead of showing step 1 first. The planner removes the attribute; so does a timer, should it
 * never start.
 */
import { DRAFT_KEY } from "./draft";

export const RESTORING = "data-restoring";

export const RESTORE_SCRIPT = `(function(){try{if(location.pathname!=="/")return;var q=new URLSearchParams(location.search);`
  + `if(!q.get("plan")&&!q.get("edit")&&!sessionStorage.getItem(${JSON.stringify(DRAFT_KEY)}))return;`
  + `var d=document.documentElement;d.setAttribute("${RESTORING}","");`
  + `setTimeout(function(){d.removeAttribute("${RESTORING}")},8000)}catch(e){}})()`;
