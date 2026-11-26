# Akwam Nuvio Provider

Standalone Akwam stream-source plugin for Nuvio. It does not depend on CinemaBox, Cinemana, SEE, or CEE.

## Install
Use the raw manifest URL:
`https://raw.githubusercontent.com/HashimFaisal/Akwam-Nuvio/main/manifest.json`

## Supported
- Movies and TV series
- Arabic/English title lookup through TMDB metadata
- Season and episode matching (strict: it returns no stream if the requested episode cannot be identified)
- Direct MP4 source extraction from Akwam watch pages

## Notes
The default host is `https://akwam.ss`; it can be changed in plugin settings. Akwam host availability and its page markup can change. Local parser tests do not prove that live search or playback works in every network or inside Nuvio. Confirm live search and playback in Nuvio before treating the provider as production-verified.
