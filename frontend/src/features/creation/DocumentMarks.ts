import {Mark, mergeAttributes} from '@tiptap/core';

export const EntityMention = Mark.create({
  name:'entityMention', inclusive:false,
  addAttributes(){return {entityId:{default:null,parseHTML:element=>element.getAttribute('data-entity-id'),renderHTML:attrs=>({'data-entity-id':attrs.entityId})}};},
  parseHTML(){return [{tag:'span[data-entity-id]'}];},
  renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{class:'entity-mention',role:'link',tabindex:'0'}),0];},
});
export const ContentLink = Mark.create({
  name:'contentLink', inclusive:false,
  addAttributes(){return {nodeId:{default:null,parseHTML:element=>element.getAttribute('data-node-id'),renderHTML:attrs=>({'data-node-id':attrs.nodeId})}};},
  parseHTML(){return [{tag:'span[data-node-id]'}];},
  renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{class:'content-link',role:'link',tabindex:'0'}),0];},
});
