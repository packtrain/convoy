"use client";

import { useState } from "react";
import { Download as DownloadIcon, X, ZoomIn, ZoomOut } from "lucide-react";
import Lightbox, {
  isImageSlide,
  type Slide,
  type SlideImage,
  type SlideVideo,
} from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Video from "yet-another-react-lightbox/plugins/video";
import DownloadPlugin from "yet-another-react-lightbox/plugins/download";
import {
  TextAttachmentDialog,
  type TextAttachmentPreview,
} from "@/components/blocks/tasks/text-attachment-dialog";

const GALLERY_SWIPE_ANIMATION_MS = 220;
const GALLERY_NAVIGATION_ANIMATION_MS = 180;
/** Top band reserved for the header pill (pill height plus its padding), so it never covers the picture. */
const SLIDE_HEADER_BAND_PX = 64;

interface AttachmentSlideMeta {
  fileName: string;
  download: {
    url: string;
    filename: string;
  };
}

export type AttachmentLightboxSlide = (SlideImage | SlideVideo) &
  AttachmentSlideMeta;

interface AttachmentLightboxProps {
  open: boolean;
  slides: AttachmentLightboxSlide[];
  initialIndex: number;
  onClose: () => void;
  onDownload: (index: number) => void;
  /** A text file opens in a dialog instead of the image/video lightbox. */
  textPreview?: TextAttachmentPreview | null;
}

function isVideoSlide(slide: Slide): slide is SlideVideo {
  return slide.type === "video";
}

function getSlideSrc(slide: Slide): string | null {
  if (isImageSlide(slide)) {
    return slide.src;
  }
  if (isVideoSlide(slide)) {
    return slide.sources[0]?.src ?? null;
  }
  return null;
}

function getSlideIndex(
  slides: AttachmentLightboxSlide[],
  slide: Slide
): number {
  const src = getSlideSrc(slide);
  if (src === null) {
    return -1;
  }

  const slideFileName = (slide as Partial<AttachmentSlideMeta>).fileName;
  const exactMatchIndex = slides.findIndex(
    (candidate) =>
      getSlideSrc(candidate) === src && candidate.fileName === slideFileName
  );
  if (exactMatchIndex >= 0) {
    return exactMatchIndex;
  }

  return slides.findIndex((candidate) => getSlideSrc(candidate) === src);
}

export function AttachmentLightbox({
  open,
  slides,
  initialIndex,
  onClose,
  onDownload,
  textPreview,
}: AttachmentLightboxProps) {
  // The library jumps back to `index` whenever `slides` changes identity, so feed it the slide in view.
  const [viewed, setViewed] = useState<{ from: number; index: number } | null>(null);
  const index = viewed?.from === initialIndex ? viewed.index : initialIndex;

  if (textPreview) {
    return <TextAttachmentDialog preview={textPreview} onClose={onClose} />;
  }

  return (
    <Lightbox
      open={open}
      close={() => {
        setViewed(null);
        onClose();
      }}
      index={index}
      on={{ view: ({ index: viewIndex }) => setViewed({ from: initialIndex, index: viewIndex }) }}
      slides={slides}
      plugins={[Zoom, Video, DownloadPlugin]}
      carousel={{ imageFit: "contain", finite: true }}
      animation={{
        swipe: GALLERY_SWIPE_ANIMATION_MS,
        navigation: GALLERY_NAVIGATION_ANIMATION_MS,
      }}
      controller={{ closeOnBackdropClick: true }}
      toolbar={{ buttons: ["download", "close"] }}
      video={{ controls: true, autoPlay: true, playsInline: true }}
      styles={{
        container: {
          // Lightbox overlays stay black regardless of app theme for image viewing.
          backgroundColor: "#000",
          ["--yarl__container_background_color"]: "#000",
        },
        slide: { paddingTop: SLIDE_HEADER_BAND_PX },
      }}
      download={{
        download: ({ slide }) => {
          const index = getSlideIndex(slides, slide);
          if (index >= 0) {
            onDownload(index);
          }
        },
      }}
      render={{
        iconClose: () => <X className="size-5" strokeWidth={1.75} />,
        iconDownload: () => <DownloadIcon className="size-5" strokeWidth={1.75} />,
        iconZoomIn: () => <ZoomIn className="size-5" strokeWidth={1.75} />,
        iconZoomOut: () => <ZoomOut className="size-5" strokeWidth={1.75} />,
        slideHeader: ({ slide }) => {
          const index = getSlideIndex(slides, slide);
          const matched = index >= 0 ? slides[index] : null;
          if (!matched) {
            return null;
          }

          return (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-4">
              <div className="flex max-w-[min(80vw,40rem)] items-baseline gap-2 rounded-full border border-border bg-background/90 px-4 py-2 text-sm text-foreground shadow-sm backdrop-blur-sm">
                <span className="shrink-0 tabular-nums text-muted-foreground">{index + 1}/{slides.length}</span>
                <span className="truncate">{matched.fileName}</span>
              </div>
            </div>
          );
        },
      }}
    />
  );
}
