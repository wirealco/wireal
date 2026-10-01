import {
  Button,
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  Label,
  Slider,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Dices } from "./icons";
import { FluidOrb } from "./FluidOrb";
import { orbPresets, randomOrb, type OrbSettings } from "./orb-settings";
export function OrbEditor({
  value,
  onChange,
}: {
  value: OrbSettings;
  onChange: (v: OrbSettings) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-center">
        <FluidOrb settings={value} size={112} label={t("editor.orbPreview")} />
      </div>
      <div className="flex justify-center gap-2">
        {orbPresets.map((p) => (
          <Button
            key={p.name}
            isIconOnly
            variant="tertiary"
            aria-label={t("editor.palette", { name: p.name })}
            onPress={() => onChange(structuredClone(p.orb))}
          >
            <FluidOrb settings={p.orb} size={24} label={p.name} />
          </Button>
        ))}
        <Button
          isIconOnly
          variant="tertiary"
          aria-label={t("editor.randomOrb")}
          onPress={() => onChange(randomOrb())}
        >
          <Dices size={18} />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {value.colors.map((c, i) => (
          <ColorPicker
            key={i}
            value={c}
            onChange={(color) => {
              const colors = [...value.colors] as OrbSettings["colors"];
              colors[i] = color.toString("hex");
              onChange({ ...value, colors });
            }}
          >
            <ColorPicker.Trigger
              aria-label={t("editor.color", { number: i + 1 })}
              className="justify-start"
            >
              <ColorSwatch size="sm" />
              <Label>{t("editor.color", { number: i + 1 })}</Label>
            </ColorPicker.Trigger>
            <ColorPicker.Popover className="w-56 gap-2">
              <ColorArea
                className="max-w-full"
                colorSpace="hsb"
                xChannel="saturation"
                yChannel="brightness"
              >
                <ColorArea.Thumb />
              </ColorArea>
              <ColorSlider channel="hue" colorSpace="hsb">
                <ColorSlider.Track>
                  <ColorSlider.Thumb />
                </ColorSlider.Track>
              </ColorSlider>
              <ColorField aria-label={t("editor.colorCode", { number: i + 1 })}>
                <ColorField.Group>
                  <ColorField.Input />
                </ColorField.Group>
              </ColorField>
            </ColorPicker.Popover>
          </ColorPicker>
        ))}
      </div>
      {(["speed", "distortion", "swirl", "phase"] as const).map((key) => (
        <Slider
          key={key}
          value={value[key]}
          onChange={(v) => onChange({ ...value, [key]: Number(v) })}
          minValue={0}
          maxValue={key === "phase" ? 100 : key === "speed" ? 2 : 1}
          step={key === "phase" ? 1 : 0.05}
        >
          <Label>{t(`editor.${key}`)}</Label>
          <Slider.Output />
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      ))}
    </div>
  );
}
