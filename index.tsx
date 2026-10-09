import { addGlobalContextMenuPatch, removeGlobalContextMenuPatch, GlobalContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ContextMenuApi, Menu } from "@webpack/common";

const ratios: Record<string, number> = { "16:9": 16 / 9, "16:10": 16 / 10, "4:3": 4 / 3, "21:9": 21 / 9, "32:9": 32 / 9 };

type Mode = "stretch" | "fit" | "fill";
const settings = definePluginSettings( {
	aspect: {
		type: OptionType.SELECT,
		description: "watched stream ratio",
		default: "off",
		options: [ { label: "off", value: "off" }, ...Object.keys( ratios ).map( value => ( { label: value, value } ) ), { label: "custom", value: "custom" } ],
		onChange: ( ) => refresh( )
	},
	mode: {
		type: OptionType.SELECT,
		description: "how it fits",
		default: "stretch",
		options: [ { label: "stretch", value: "stretch" }, { label: "fit", value: "fit" }, { label: "fill", value: "fill" } ],
		onChange: ( ) => refresh( )
	},
	customWidth: { type: OptionType.NUMBER, description: "custom width", default: 4, onChange: ( ) => refresh( ) },
	customHeight: { type: OptionType.NUMBER, description: "custom height", default: 3, onChange: ( ) => refresh( ) }
} );

type View = {
	video: HTMLVideoElement;
	parent: HTMLElement;
	original: Map<string, [
		string,
		string
	]>;
	parent_position: string;
	parent_priority: string;
	positioned: boolean;
	observer: ResizeObserver;
	wrappers: Map<HTMLElement, Map<string, [
		string,
		string
	]>>;
	streamKey: string | null;
};
const views = new Map<HTMLVideoElement, View>( );
let candidate: HTMLVideoElement | null = null;
let candidate_time = 0;
let mutations: MutationObserver | null = null;
let layout_frame = 0;
const properties = [ "position", "left", "top", "width", "height", "max-width", "max-height", "min-width", "min-height", "aspect-ratio", "object-fit", "transform", "margin" ];

function ratio( )
{
	if ( settings.store.aspect === "custom" )
	{
		const w = Number( settings.store.customWidth ), h = Number( settings.store.customHeight );

		return Number.isFinite( w ) && Number.isFinite( h ) && w > 0 && h > 0 ? w / h : null;
	}

	return ratios[ settings.store.aspect ?? "off" ] ?? null;
}

function video_at( target: EventTarget | null ): HTMLVideoElement | null
{
	let el = target instanceof Element ? target : null;
	for ( let depth = 0; el && depth < 7; depth++, el = el.parentElement )
	{
		if ( el instanceof HTMLVideoElement )
			return el;
		const videos = el.querySelectorAll( "video" );

		if ( videos.length === 1 )
			return videos[ 0 ];
		if ( videos.length > 1 )
			return null;
	}

	return null;
}

function capture( event: MouseEvent )
{
	candidate = video_at( event.target );
	candidate_time = Date.now( );
}

function is_visible( el: Element )
{
	const rect = el.getBoundingClientRect( );

	return rect.width > 0 && rect.height > 0 && getComputedStyle( el ).visibility !== "hidden";
}

function player_frame( video: HTMLVideoElement ): HTMLElement | null
{
	let frame = video.parentElement;
	if ( !frame )
		return null;
	for ( let el = frame.parentElement, depth = 0; el && depth < 20; el = el.parentElement, depth++ )
	{
		if ( /grid/i.test( el.className ) && el.children.length > 1 )
			break;
		if ( el === document.body || el === document.documentElement )
			break;
		if ( [ ...el.querySelectorAll( "video" ) ].filter( is_visible ).length > 1 )
			break;
		if ( [ ...el.querySelectorAll( 'textarea,[role="textbox"],nav,[role="navigation"],[data-list-id="chat-messages"]' ) ].some( is_visible ) )
			break;
		const rect = el.getBoundingClientRect( );

		if ( rect.width > 0 && rect.height > 0 )
		{
			frame = el;
		}
	}

	return frame;
}

function restore( view: View )
{
	for ( const [ el, original ] of view.wrappers )
	{
		for ( const [ key, [ value, priority ] ] of original )
		{
			if ( value )
				el.style.setProperty( key, value, priority );
			else
				el.style.removeProperty( key );
		}
	}
	for ( const [ key, [ value, priority ] ] of view.original )
	{
		if ( value )
			view.video.style.setProperty( key, value, priority );
		else
			view.video.style.removeProperty( key );
	}
	if ( view.positioned )
	{
		if ( view.parent_position )
			view.parent.style.setProperty( "position", view.parent_position, view.parent_priority );
		else
			view.parent.style.removeProperty( "position" );
		view.positioned = false;
	}
}

function render( view: View )
{
	const r = ratio( );

	if ( !r )
	{
		restore( view );
		return;
	}
	const { video, parent } = view;
	const { width, height } = parent.getBoundingClientRect( );

	if ( !width || !height )
		return;
	for ( const el of view.wrappers.keys( ) )
	{
		const overrides: Record<string, string> = { position: "absolute", inset: "0", width: "100%", height: "100%", "max-width": "none", "max-height": "none", "aspect-ratio": "auto", transform: "none", margin: "0" };

		for ( const [ key, value ] of Object.entries( overrides ) )
			el.style.setProperty( key, value, "important" );
	}
	const w = Math.min( width, height * r ), h = w / r;

	if ( getComputedStyle( parent ).position === "static" )
	{
		parent.style.setProperty( "position", "relative" );
		view.positioned = true;
	}
	const values: Record<string, string> = {
		position: "absolute", left: "50%", top: "50%", width: `${w}px`, height: `${h}px`,
		"max-width": "none", "max-height": "none", "min-width": "0", "min-height": "0",
		"aspect-ratio": "auto", "object-fit": ( { stretch: "fill", fit: "contain", fill: "cover" } as const )[ settings.store.mode as Mode ],
		transform: "translate(-50%, -50%)", margin: "0"
	};
	for ( const [ key, value ] of Object.entries( values ) )
	{
		if ( video.style.getPropertyValue( key ) !== value || video.style.getPropertyPriority( key ) !== "important" )
			video.style.setProperty( key, value, "important" );
	}
}

function select( video: HTMLVideoElement )
{
	if ( views.has( video ) )
		return;
	const parent = player_frame( video );

	if ( !parent )
		return;
	const wrappers = new Map<HTMLElement, Map<string, [
		string,
		string
	]>>( );
	for ( let el = video.parentElement; el && el !== parent; el = el.parentElement )
	{
		const keys = [ "position", "inset", "width", "height", "max-width", "max-height", "aspect-ratio", "transform", "margin" ];
		wrappers.set( el, new Map( keys.map( key => [ key, [ el.style.getPropertyValue( key ), el.style.getPropertyPriority( key ) ] ] ) ) );
	}
	const view: View = {
		wrappers, streamKey: stream_identity( video ),
		video, parent, original: new Map( properties.map( key => [ key, [ video.style.getPropertyValue( key ), video.style.getPropertyPriority( key ) ] ] ) ),
		parent_position: parent.style.getPropertyValue( "position" ), parent_priority: parent.style.getPropertyPriority( "position" ), positioned: false,
		observer: new ResizeObserver( queue_refresh )
	};
	views.set( video, view );
	view.observer.observe( parent );
}

function stream_identity( video: HTMLVideoElement ): string | null
{
	const reactKey = Object.keys( video ).find( key => key.startsWith( "__reactFiber$" ) );
	let fiber = reactKey ? ( video as any )[ reactKey ] : null;
	for ( let i = 0; fiber && i < 25; i++, fiber = fiber.return )
	{
		const props = fiber.memoizedProps ?? fiber.pendingProps;

		if ( typeof props?.streamKey === "string" )
			return `stream:${props.streamKey}`;
	}
	if ( video.srcObject instanceof MediaStream )
	{
		const track = video.srcObject.getVideoTracks( )[ 0 ];

		if ( track )
			return `track:${track.id}`;
	}

	return video.getAttribute( "src" ) || null;
}

function queue_refresh( )
{
	if ( layout_frame || document.visibilityState === "hidden" )
		return;
	layout_frame = requestAnimationFrame( ( ) =>
	{ layout_frame = 0; refresh( ); } );
}

function refresh( )
{
	for ( const [ video, view ] of views )
	{
		restore( view );
		if ( !video.isConnected )
		{
			const candidates = [ ...document.querySelectorAll( "video" ) ];
			const replacement = candidates.find( next => view.streamKey && stream_identity( next ) === view.streamKey )
				?? ( view.parent.isConnected && view.parent.querySelectorAll( "video" ).length === 1 ? view.parent.querySelector( "video" ) : null );
			view.observer.disconnect( );
			views.delete( video );
			if ( replacement && !views.has( replacement ) )
			{
				select( replacement );
				render( views.get( replacement )! );
			}
			continue;
		}
		const next_parent = player_frame( video );

		if ( next_parent && next_parent !== view.parent )
		{
			view.observer.disconnect( );
			views.delete( video );
			select( video );
			render( views.get( video )! );
		}
		else
			render( view );
	}
}

function is_stream_menu( children: any[ ] ): boolean
{
	return children.some( child =>
	{
		if ( !child )
			return false;
		if ( Array.isArray( child ) )
			return is_stream_menu( child );
		const p = child.props;

		if ( !p )
			return false;
		if ( /stop[-_ ]?watch/i.test( String( p.id ) ) || ( typeof p.label === "string" && /stop watching/i.test( p.label ) ) )
			return true;
		return p.children ? is_stream_menu( Array.isArray( p.children ) ? p.children : [ p.children ] ) : false;
	} );
}
const patch: GlobalContextMenuPatchCallback = ( _navId, children, ...args ) =>
{
	if ( !is_stream_menu( children ) )
		return;
	const video = Date.now( ) - candidate_time < 2000 ? candidate : null;
	const target = video ?? args.map( arg => video_at( arg?.target ?? arg?.event?.target ) ).find( Boolean );

	if ( !target )
		return;
	children.push( make_stream_controls( target ) );
};

function make_stream_controls( target: HTMLVideoElement )
{
	const { aspect, mode } = settings.store;
	const choose = ( nextAspect: string, nextMode: Mode ) =>
	{
		select( target );
		settings.store.mode = nextMode;
		settings.store.aspect = nextAspect as any;
		refresh( );
		ContextMenuApi.closeContextMenu( );
	};
	return ( <Menu.MenuGroup>
			<Menu.MenuItem id="vc-stream-display" label="stream display">
				<Menu.MenuCheckboxItem id="vc-stream-original" label="original" checked={!aspect || aspect === "off"} action={( ) => choose( "off", "stretch" )}/>
				<Menu.MenuCheckboxItem id="vc-stream-widescreen" label="stretch" checked={aspect === "16:9" && mode === "stretch"} action={( ) => choose( "16:9", "stretch" )}/>
			</Menu.MenuItem>
		</Menu.MenuGroup> );
}

export default definePlugin( {
	name: "ForceStreamAspectRatio",
	description: "stretches watched streams",
	authors: [ { name: "Local Userplugin", id: 0n } ],
	settings,
	start( )
	{
		document.addEventListener( "contextmenu", capture, true );
		addGlobalContextMenuPatch( patch );
		mutations = new MutationObserver( records =>
		{
			if ( records.some( record => record.type === "childList" || [ ...views.keys( ) ].some( video => record.target instanceof Element && record.target.contains( video ) ) ) )
				queue_refresh( );
		} );
		window.addEventListener( "resize", queue_refresh );
		window.addEventListener( "focus", queue_refresh );
		document.addEventListener( "fullscreenchange", queue_refresh );
		document.addEventListener( "visibilitychange", queue_refresh );
		document.addEventListener( "transitionend", queue_refresh, true );
		document.addEventListener( "loadedmetadata", queue_refresh, true );
		mutations.observe( document.body, { childList: true, attributes: true, attributeFilter: [ "class", "hidden" ], subtree: true } );
	},
	stop( )
	{
		document.removeEventListener( "contextmenu", capture, true );
		removeGlobalContextMenuPatch( patch );
		window.removeEventListener( "resize", queue_refresh );
		window.removeEventListener( "focus", queue_refresh );
		document.removeEventListener( "fullscreenchange", queue_refresh );
		document.removeEventListener( "visibilitychange", queue_refresh );
		document.removeEventListener( "transitionend", queue_refresh, true );
		document.removeEventListener( "loadedmetadata", queue_refresh, true );
		cancelAnimationFrame( layout_frame );
		layout_frame = 0;
		mutations?.disconnect( );
		mutations = null;
		for ( const view of views.values( ) )
		{
			view.observer.disconnect( );
			restore( view );
		}
		views.clear( );
		candidate = null;
	}
} );
